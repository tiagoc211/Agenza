const { randomUUID } = require('node:crypto');

const { TerminalSession } = require('./terminal-session');

const DEFAULT_STOP_TIMEOUT_MS = 10000;
const TERMINAL_SESSION_ID_PATTERN =
  /^terminal-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createTerminalSessionId = (uuidGenerator = randomUUID) => `terminal-${uuidGenerator()}`;

const assertSessionId = (id) => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('A terminal session requires a non-empty string id.');
  }
};

const getDefaultShellOptions = ({
  platform = process.platform,
  environment = process.env,
  cwd = process.cwd(),
} = {}) => {
  if (platform === 'win32') {
    return {
      shell: 'powershell.exe',
      args: ['-NoLogo'],
      cwd,
      env: environment,
      useConpty: true,
    };
  }

  return {
    shell: environment.SHELL || '/bin/sh',
    args: [],
    cwd,
    env: environment,
    useConpty: false,
  };
};

class TerminalManager {
  constructor({
    initialSessionIds = [],
    sessionFactory = (id) => new TerminalSession({ id }),
    sessionDefaults = getDefaultShellOptions(),
    sessionIdFactory = createTerminalSessionId,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  } = {}) {
    if (!Array.isArray(initialSessionIds)) {
      throw new TypeError('Initial terminal session ids must be an array.');
    }

    if (new Set(initialSessionIds).size !== initialSessionIds.length) {
      throw new Error('Initial terminal session ids must be unique.');
    }

    if (initialSessionIds.some((id) => !TERMINAL_SESSION_ID_PATTERN.test(id))) {
      throw new Error('Initial terminal session ids must use the terminal UUID format.');
    }

    if (typeof sessionFactory !== 'function' || typeof sessionIdFactory !== 'function') {
      throw new TypeError('TerminalManager requires session and id factories.');
    }

    if (!Number.isInteger(stopTimeoutMs) || stopTimeoutMs < 1) {
      throw new RangeError('Terminal stop timeout must be a positive integer.');
    }

    this._sessionDefaults = sessionDefaults;
    this._sessionFactory = sessionFactory;
    this._sessionIdFactory = sessionIdFactory;
    this._stopTimeoutMs = stopTimeoutMs;
    this._sessions = new Map();
    this._retiredSessionIds = new Set();
    this._sessionSubscriptions = new Map();
    this._dataListeners = new Set();
    this._exitListeners = new Set();

    for (const id of initialSessionIds) {
      this._registerSession(id);
    }
  }

  create({ id = this._sessionIdFactory() } = {}) {
    if (typeof id !== 'string' || !TERMINAL_SESSION_ID_PATTERN.test(id)) {
      throw new Error('New terminal session ids must use the terminal UUID format.');
    }

    return this._registerSession(id);
  }

  _registerSession(id) {
    assertSessionId(id);

    if (this._sessions.has(id) || this._retiredSessionIds.has(id)) {
      throw new Error(`Terminal session "${id}" already exists or has been retired.`);
    }

    const session = this._sessionFactory(id);

    if (!session || session.id !== id) {
      throw new Error(`Terminal session factory returned an invalid session for "${id}".`);
    }

    const unsubscribeData = session.onData((data) => {
      for (const listener of this._dataListeners) {
        listener({ data, id });
      }
    });
    const unsubscribeExit = session.onExit((event) => {
      for (const listener of this._exitListeners) {
        listener({ event, id });
      }
    });

    this._sessions.set(id, session);
    this._sessionSubscriptions.set(id, [unsubscribeData, unsubscribeExit]);
    return session.snapshot();
  }

  has(id) {
    return typeof id === 'string' && this._sessions.has(id);
  }

  list() {
    return [...this._sessions.values()].map((session) => session.snapshot());
  }

  start(id, options = {}) {
    return this._getSession(id).start({ ...this._sessionDefaults, ...options });
  }

  startAll(optionsById = {}) {
    const startedSessions = [];

    try {
      const snapshots = [];

      for (const id of this._sessions.keys()) {
        snapshots.push(this.start(id, optionsById[id] ?? {}));
        startedSessions.push(this._getSession(id));
      }

      return snapshots;
    } catch (error) {
      for (const session of startedSessions) {
        session.kill();
      }

      throw error;
    }
  }

  async restart(id, options = {}) {
    const session = this._getSession(id);

    await this._stopSession(session);
    return this.start(id, options);
  }

  remove(id) {
    const session = this._getSession(id);
    let disposalError;

    try {
      session.dispose();
    } catch (error) {
      disposalError = error;
    }

    if (disposalError) {
      throw disposalError;
    }

    this._unsubscribeSession(id);
    this._sessions.delete(id);
    this._retiredSessionIds.add(id);
    return true;
  }

  write(id, data) {
    this._getSession(id).write(data);
  }

  resize(id, columns, rows) {
    this._getSession(id).resize(columns, rows);
  }

  clear(id) {
    this._getSession(id).clear();
  }

  kill(id) {
    return this._getSession(id).kill();
  }

  killAll() {
    const errors = [];

    for (const session of this._sessions.values()) {
      try {
        session.kill();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Unable to terminate every terminal process tree.');
    }
  }

  onData(id, listener) {
    return this._getSession(id).onData(listener);
  }

  onExit(id, listener) {
    return this._getSession(id).onExit(listener);
  }

  onSessionData(listener) {
    return this._subscribe(this._dataListeners, listener);
  }

  onSessionExit(listener) {
    return this._subscribe(this._exitListeners, listener);
  }

  getSnapshot(id) {
    return this._getSession(id).snapshot();
  }

  getSnapshots() {
    return this.list();
  }

  dispose() {
    const errors = [];

    for (const [id, session] of this._sessions) {
      try {
        session.dispose();
      } catch (error) {
        errors.push(error);
      } finally {
        this._unsubscribeSession(id);
      }
    }

    this._sessions.clear();
    this._dataListeners.clear();
    this._exitListeners.clear();

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Unable to dispose every terminal session.');
    }
  }

  _getSession(id) {
    const session = this._sessions.get(id);

    if (!session) {
      throw new Error(`Unknown terminal session "${id}".`);
    }

    return session;
  }

  _stopSession(session) {
    if (!session.snapshot().isRunning) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Terminal session "${session.id}" did not stop in time.`));
      }, this._stopTimeoutMs);

      unsubscribe = session.onExit(() => {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });

      try {
        session.kill();
      } catch (error) {
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
      }
    });
  }

  _subscribe(listeners, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Terminal event listener must be a function.');
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  _unsubscribeSession(id) {
    for (const unsubscribe of this._sessionSubscriptions.get(id) ?? []) {
      unsubscribe();
    }

    this._sessionSubscriptions.delete(id);
  }
}

module.exports = {
  DEFAULT_STOP_TIMEOUT_MS,
  TERMINAL_SESSION_ID_PATTERN,
  TerminalManager,
  createTerminalSessionId,
  getDefaultShellOptions,
};
