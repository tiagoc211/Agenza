const { discoverGitRepository } = require('./git-discovery');
const { toGitErrorPayload } = require('./git-command');
const { GIT_CHANNELS } = require('./ipc-channels');

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const writeLog = (logger, level, event, details) => {
  try {
    return logger?.[level]?.(event, details) ?? false;
  } catch {
    return false;
  }
};

const registerGitIpc = ({
  discover = discoverGitRepository,
  ipcMain,
  logger,
  window,
  workspaceService,
} = {}) => {
  if (!ipcMain || !window || !workspaceService || typeof discover !== 'function') {
    throw new TypeError(
      'Git IPC requires ipcMain, a window, workspace access, and repository discovery.',
    );
  }

  const handleDiscover = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git discovery request.');
    }

    const { id } = payload ?? {};

    if (typeof id !== 'string' || !workspaceService.has(id)) {
      throw new Error('Invalid terminal Git discovery id.');
    }

    const projectPath = workspaceService.getCurrentFolder(id);

    if (!projectPath) {
      return {
        error: {
          code: 'PROJECT_FOLDER_UNAVAILABLE',
          message: 'Select an accessible project folder before inspecting Git.',
        },
        id,
        ok: false,
      };
    }

    writeLog(logger, 'info', 'git.discovery_requested', { terminalId: id });

    try {
      const repository = await discover(projectPath);
      writeLog(logger, 'info', 'git.discovery_succeeded', { terminalId: id });
      return { id, ok: true, repository };
    } catch (error) {
      const errorPayload = toGitErrorPayload(error);
      writeLog(logger, 'warn', 'git.discovery_failed', {
        error: { code: errorPayload.code },
        terminalId: id,
      });
      return { error: errorPayload, id, ok: false };
    }
  };

  ipcMain.handle(GIT_CHANNELS.discover, handleDiscover);

  return () => ipcMain.removeHandler(GIT_CHANNELS.discover);
};

module.exports = {
  isTrustedEvent,
  registerGitIpc,
};
