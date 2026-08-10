const { TERMINAL_CHANNELS } = require('./ipc-channels');
const { MAX_TERMINAL_DIMENSION } = require('./terminal-session');

const MAX_INPUT_LENGTH = 1024 * 1024;

const assertSessionId = (manager, id) => {
  if (typeof id !== 'string' || !manager.has(id)) {
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

const writeLog = (logger, level, event, details) => {
  try {
    return logger?.[level]?.(event, details) ?? false;
  } catch {
    return false;
  }
};

const registerTerminalIpc = ({
  catalog,
  ipcMain,
  window,
  manager,
  logger,
  prepare = () => undefined,
}) => {
  if (!ipcMain || !window || !manager) {
    throw new TypeError('Terminal IPC requires ipcMain, a window, and a terminal manager.');
  }

  const sessionCatalog = catalog ?? manager;

  const sendToRenderer = (channel, payload) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  };

  const outputSubscriptions = [
    manager.onSessionData(({ id, data }) => sendToRenderer(TERMINAL_CHANNELS.data, { id, data })),
    manager.onSessionExit(({ id, event }) => {
      writeLog(logger, 'warn', 'terminal.exited', {
        exitCode: event.exitCode,
        signal: event.signal,
        terminalId: id,
      });
      sendToRenderer(TERMINAL_CHANNELS.exit, {
        id,
        exitCode: event.exitCode,
        signal: event.signal,
      });
    }),
  ];

  const requireTrustedEvent = (event, action) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error(`Untrusted terminal ${action} request.`);
    }
  };

  const restoreWindowFocus = () => {
    if (window.isDestroyed() || typeof window.focus !== 'function') {
      return;
    }

    try {
      window.focus();
    } catch {
      // Focus recovery must not turn a completed terminal action into a failure.
    }
  };

  const handleActivate = async (event, payload) => {
    requireTrustedEvent(event, 'activate');
    const { id } = payload ?? {};

    if (id !== null) {
      assertSessionId(manager, id);
    }

    return sessionCatalog.activate?.(id) ?? { activeTerminalId: id };
  };

  const handleCreate = async (event) => {
    requireTrustedEvent(event, 'create');
    const snapshot = await sessionCatalog.create();
    writeLog(logger, 'info', 'terminal.created', { terminalId: snapshot.id });
    return snapshot;
  };

  const handleList = async (event) => {
    requireTrustedEvent(event, 'list');
    return sessionCatalog.list();
  };

  const handleDetachWorkspace = async (event, payload) => {
    requireTrustedEvent(event, 'workspace detach');
    const { id } = payload ?? {};
    assertSessionId(manager, id);

    if (typeof sessionCatalog.detachWorkspace !== 'function') {
      throw new Error('Terminal workspace detach is unavailable.');
    }

    writeLog(logger, 'info', 'workspace.detach_requested', { terminalId: id });

    try {
      const snapshot = await sessionCatalog.detachWorkspace(id);
      writeLog(logger, 'info', 'workspace.detach_succeeded', { terminalId: id });
      return snapshot;
    } catch (error) {
      writeLog(logger, 'error', 'workspace.detach_failed', { error, terminalId: id });
      throw error;
    } finally {
      restoreWindowFocus();
    }
  };

  const handleRemove = async (event, payload) => {
    requireTrustedEvent(event, 'remove');
    const { id } = payload ?? {};
    assertSessionId(manager, id);
    writeLog(logger, 'info', 'terminal.remove_requested', { terminalId: id });

    try {
      await sessionCatalog.remove(id);
      writeLog(logger, 'info', 'terminal.remove_succeeded', { terminalId: id });
      return { id, removed: true };
    } catch (error) {
      writeLog(logger, 'error', 'terminal.remove_failed', { error, terminalId: id });
      throw error;
    } finally {
      restoreWindowFocus();
    }
  };

  const handleStart = async (event, payload) => {
    requireTrustedEvent(event, 'start');
    const { id } = payload ?? {};

    if (id !== undefined) {
      assertSessionId(manager, id);
    }

    const terminalId = id ?? 'all';
    writeLog(logger, 'info', 'terminal.start_requested', { terminalId });

    try {
      if (id !== undefined) {
        const snapshot = manager.getSnapshot(id);

        if (snapshot.isRunning) {
          writeLog(logger, 'info', 'terminal.start_skipped', {
            reason: 'already running',
            terminalId,
          });
          return snapshot;
        }

        const options = (await prepare(id)) ?? {};
        const startedSession = manager.start(id, options);
        writeLog(logger, 'info', 'terminal.start_succeeded', {
          pid: startedSession.pid,
          terminalId,
        });
        return startedSession;
      }

      const snapshots = manager.list();

      if (snapshots.every((snapshot) => snapshot.isRunning)) {
        writeLog(logger, 'info', 'terminal.start_skipped', {
          reason: 'all sessions already running',
          terminalId,
        });
        return snapshots;
      }

      if (snapshots.some((snapshot) => snapshot.isRunning)) {
        throw new Error('Terminal sessions are in an inconsistent startup state.');
      }

      if (process.argv.includes('--startup-check')) {
        console.log('[startup-check] starting terminal sessions');
      }
      const optionsById = (await prepare()) ?? {};
      const startedSessions = manager.startAll(optionsById);
      if (process.argv.includes('--startup-check')) {
        console.log('[startup-check] terminal sessions started');
      }
      writeLog(logger, 'info', 'terminal.start_succeeded', {
        sessions: startedSessions.map(({ id: startedId, pid }) => ({ id: startedId, pid })),
        terminalId,
      });
      return startedSessions;
    } catch (error) {
      writeLog(logger, 'error', 'terminal.start_failed', { error, terminalId });
      throw error;
    }
  };

  const handleRestart = async (event, payload) => {
    requireTrustedEvent(event, 'restart');
    const { id } = payload ?? {};
    assertSessionId(manager, id);
    writeLog(logger, 'info', 'terminal.restart_requested', { terminalId: id });

    try {
      const options = (await prepare(id)) ?? {};
      const restartedSession = await manager.restart(id, options);
      writeLog(logger, 'info', 'terminal.restart_succeeded', {
        pid: restartedSession.pid,
        terminalId: id,
      });
      return restartedSession;
    } catch (error) {
      writeLog(logger, 'error', 'terminal.restart_failed', { error, terminalId: id });
      throw error;
    }
  };

  const handleInput = (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      return;
    }

    const { id, data } = payload ?? {};
    assertSessionId(manager, id);

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
    assertSessionId(manager, id);
    assertDimension(columns, 'columns');
    assertDimension(rows, 'rows');
    manager.resize(id, columns, rows);
  };

  ipcMain.handle(TERMINAL_CHANNELS.activate, handleActivate);
  ipcMain.handle(TERMINAL_CHANNELS.create, handleCreate);
  ipcMain.handle(TERMINAL_CHANNELS.detachWorkspace, handleDetachWorkspace);
  ipcMain.handle(TERMINAL_CHANNELS.list, handleList);
  ipcMain.handle(TERMINAL_CHANNELS.remove, handleRemove);
  ipcMain.handle(TERMINAL_CHANNELS.start, handleStart);
  ipcMain.handle(TERMINAL_CHANNELS.restart, handleRestart);
  ipcMain.on(TERMINAL_CHANNELS.input, handleInput);
  ipcMain.on(TERMINAL_CHANNELS.resize, handleResize);

  return () => {
    ipcMain.removeHandler(TERMINAL_CHANNELS.activate);
    ipcMain.removeHandler(TERMINAL_CHANNELS.create);
    ipcMain.removeHandler(TERMINAL_CHANNELS.detachWorkspace);
    ipcMain.removeHandler(TERMINAL_CHANNELS.list);
    ipcMain.removeHandler(TERMINAL_CHANNELS.remove);
    ipcMain.removeHandler(TERMINAL_CHANNELS.start);
    ipcMain.removeHandler(TERMINAL_CHANNELS.restart);
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
  writeLog,
};
