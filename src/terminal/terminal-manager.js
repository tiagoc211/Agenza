const { TerminalSession } = require('./terminal-session');

const DEFAULT_SESSION_IDS = Object.freeze(['terminal-one', 'terminal-two']);

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
    sessionIds = DEFAULT_SESSION_IDS,
    sessionFactory = (id) => new TerminalSession({ id }),
    sessionDefaults = getDefaultShellOptions(),
  } = {}) {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      throw new TypeError('TerminalManager requires at least one session id.');
    }

    if (new Set(sessionIds).size !== sessionIds.length) {
      throw new Error('TerminalManager session ids must be unique.');
    }

    this._sessionDefaults = sessionDefaults;
    this._sessions = new Map(
      sessionIds.map((id) => {
        const session = sessionFactory(id);

        if (!session || session.id !== id) {
          throw new Error(`Terminal session factory returned an invalid session for "${id}".`);
        }

        return [id, session];
      }),
    );
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

  getSnapshot(id) {
    return this._getSession(id).snapshot();
  }

  getSnapshots() {
    return [...this._sessions.values()].map((session) => session.snapshot());
  }

  dispose() {
    const errors = [];

    for (const session of this._sessions.values()) {
      try {
        session.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

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
}

module.exports = {
  DEFAULT_SESSION_IDS,
  TerminalManager,
  getDefaultShellOptions,
};
