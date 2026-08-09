const { TERMINAL_CHANNELS } = require('./ipc-channels');
const { DEFAULT_SESSION_IDS } = require('./terminal-manager');
const { MAX_TERMINAL_DIMENSION } = require('./terminal-session');

const MAX_INPUT_LENGTH = 1024 * 1024;
const validSessionIds = new Set(DEFAULT_SESSION_IDS);

const assertSessionId = (id) => {
  if (!validSessionIds.has(id)) {
    throw new Error('Invalid terminal session id.');
  }
};

const assertDimension = (value, name) => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TERMINAL_DIMENSION) {
    throw new RangeError(`${name} must be a valid terminal dimension.`);
  }
};

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const registerTerminalIpc = ({ ipcMain, window, manager }) => {
  if (!ipcMain || !window || !manager) {
    throw new TypeError('Terminal IPC requires ipcMain, a window, and a terminal manager.');
  }

  const sendToRenderer = (channel, payload) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  };

  const outputSubscriptions = DEFAULT_SESSION_IDS.flatMap((id) => [
    manager.onData(id, (data) => sendToRenderer(TERMINAL_CHANNELS.data, { id, data })),
    manager.onExit(id, (event) =>
      sendToRenderer(TERMINAL_CHANNELS.exit, {
        id,
        exitCode: event.exitCode,
        signal: event.signal,
      }),
    ),
  ]);

  const handleStart = (event) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted terminal start request.');
    }

    const snapshots = manager.getSnapshots();

    if (snapshots.every((snapshot) => snapshot.isRunning)) {
      return snapshots;
    }

    if (snapshots.some((snapshot) => snapshot.isRunning)) {
      throw new Error('Terminal sessions are in an inconsistent startup state.');
    }

    if (process.argv.includes('--startup-check')) {
      console.log('[startup-check] starting terminal sessions');
    }
    const startedSessions = manager.startAll();
    if (process.argv.includes('--startup-check')) {
      console.log('[startup-check] terminal sessions started');
    }
    return startedSessions;
  };

  const handleInput = (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      return;
    }

    const { id, data } = payload ?? {};
    assertSessionId(id);

    if (typeof data !== 'string' || data.length > MAX_INPUT_LENGTH) {
      throw new TypeError('Terminal input must be a valid string.');
    }

    manager.write(id, data);
  };

  const handleResize = (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      return;
    }

    const { id, columns, rows } = payload ?? {};
    assertSessionId(id);
    assertDimension(columns, 'columns');
    assertDimension(rows, 'rows');
    manager.resize(id, columns, rows);
  };

  ipcMain.handle(TERMINAL_CHANNELS.start, handleStart);
  ipcMain.on(TERMINAL_CHANNELS.input, handleInput);
  ipcMain.on(TERMINAL_CHANNELS.resize, handleResize);

  return () => {
    ipcMain.removeHandler(TERMINAL_CHANNELS.start);
    ipcMain.removeListener(TERMINAL_CHANNELS.input, handleInput);
    ipcMain.removeListener(TERMINAL_CHANNELS.resize, handleResize);

    for (const unsubscribe of outputSubscriptions) {
      unsubscribe();
    }
  };
};

module.exports = {
  MAX_INPUT_LENGTH,
  isTrustedEvent,
  registerTerminalIpc,
};
