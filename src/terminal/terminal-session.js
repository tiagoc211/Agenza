const nodePty = require('node-pty');

const { killProcessTree } = require('./process-tree');

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MAX_TERMINAL_DIMENSION = 1000;

const assertDimension = (value, name) => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TERMINAL_DIMENSION) {
    throw new RangeError(`${name} must be an integer between 1 and ${MAX_TERMINAL_DIMENSION}.`);
  }
};

const normalizeEnvironment = (environment) =>
  Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, String(value)]],
    ),
  );

class TerminalSession {
  constructor({ id, processTreeKiller = killProcessTree, ptyModule = nodePty } = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('A terminal session requires a non-empty string id.');
    }

    if (!ptyModule || typeof ptyModule.spawn !== 'function') {
      throw new TypeError('A terminal session requires a PTY module with a spawn function.');
    }

    if (typeof processTreeKiller !== 'function') {
      throw new TypeError('A terminal session requires a process tree killer.');
    }

    this.id = id;
    this._ptyModule = ptyModule;
    this._processTreeKiller = processTreeKiller;
    this._process = null;
    this._columns = DEFAULT_COLUMNS;
    this._rows = DEFAULT_ROWS;
    this._dataListeners = new Set();
    this._exitListeners = new Set();
    this._dataDisposable = null;
    this._exitDisposable = null;
  }

  get isRunning() {
    return this._process !== null;
  }

  get pid() {
    return this._process?.pid ?? null;
  }

  get dimensions() {
    return { columns: this._columns, rows: this._rows };
  }

  start({
    shell,
    args = [],
    cwd = process.cwd(),
    env = process.env,
    columns = DEFAULT_COLUMNS,
    rows = DEFAULT_ROWS,
    name = 'xterm-256color',
    useConpty = process.platform === 'win32',
    useConptyDll = false,
  } = {}) {
    if (this.isRunning) {
      throw new Error(`Terminal session "${this.id}" is already running.`);
    }

    if (typeof shell !== 'string' || shell.length === 0) {
      throw new TypeError('A terminal session requires a shell executable.');
    }

    if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
      throw new TypeError('Terminal shell arguments must be an array of strings.');
    }

    assertDimension(columns, 'columns');
    assertDimension(rows, 'rows');

    const terminalProcess = this._ptyModule.spawn(shell, args, {
      cols: columns,
      cwd,
      env: normalizeEnvironment(env),
      name,
      rows,
      useConpty,
      useConptyDll,
    });

    this._process = terminalProcess;
    this._columns = columns;
    this._rows = rows;
    this._dataDisposable = terminalProcess.onData((data) => {
      for (const listener of this._dataListeners) {
        listener(data);
      }
    });
    this._exitDisposable = terminalProcess.onExit((event) => {
      if (this._process !== terminalProcess) {
        return;
      }

      this._disposeProcessListeners();
      this._process = null;

      for (const listener of this._exitListeners) {
        listener(event);
      }
    });

    return this.snapshot();
  }

  write(data) {
    if (typeof data !== 'string') {
      throw new TypeError('Terminal input must be a string.');
    }

    this._requireProcess().write(data);
  }

  resize(columns, rows) {
    assertDimension(columns, 'columns');
    assertDimension(rows, 'rows');

    this._requireProcess().resize(columns, rows);
    this._columns = columns;
    this._rows = rows;
  }

  clear() {
    this._requireProcess().clear();
  }

  kill() {
    if (!this._process) {
      return false;
    }

    const terminalProcess = this._process;
    let treeWasKilled = false;

    try {
      treeWasKilled = this._processTreeKiller(terminalProcess.pid);
    } catch (error) {
      try {
        terminalProcess.kill();
      } catch {
        // Preserve the process-tree error, which contains the actionable failure.
      }

      throw error;
    }

    if (!treeWasKilled) {
      terminalProcess.kill();
    }

    return true;
  }

  onData(listener) {
    return this._subscribe(this._dataListeners, listener);
  }

  onExit(listener) {
    return this._subscribe(this._exitListeners, listener);
  }

  snapshot() {
    return {
      id: this.id,
      isRunning: this.isRunning,
      pid: this.pid,
      columns: this._columns,
      rows: this._rows,
    };
  }

  dispose() {
    let killError;

    try {
      this.kill();
    } catch (error) {
      killError = error;
    }

    this._process = null;
    this._disposeProcessListeners();
    this._dataListeners.clear();
    this._exitListeners.clear();

    if (killError) {
      throw killError;
    }
  }

  _requireProcess() {
    if (!this._process) {
      throw new Error(`Terminal session "${this.id}" is not running.`);
    }

    return this._process;
  }

  _subscribe(listeners, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Terminal event listener must be a function.');
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  _disposeProcessListeners() {
    this._dataDisposable?.dispose();
    this._exitDisposable?.dispose();
    this._dataDisposable = null;
    this._exitDisposable = null;
  }
}

module.exports = {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  MAX_TERMINAL_DIMENSION,
  TerminalSession,
};
