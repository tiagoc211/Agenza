const { discoverGitRepository } = require('./git-discovery');
const { toGitErrorPayload } = require('./git-command');
const {
  GitWorkspaceExecutionError,
  GitWorkspaceExecutor,
  toGitWorkspaceExecutionErrorPayload,
} = require('./git-workspace-executor');
const { GitWorkspacePlanner, toGitWorkspacePlanErrorPayload } = require('./git-workspace-planner');
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
  executor,
  planner,
  startTerminal = async () => null,
  window,
  workspaceService,
} = {}) => {
  if (
    !ipcMain ||
    !window ||
    !workspaceService ||
    typeof discover !== 'function' ||
    typeof startTerminal !== 'function'
  ) {
    throw new TypeError(
      'Git IPC requires ipcMain, a window, workspace access, and repository discovery.',
    );
  }

  const workspacePlanner = planner ?? new GitWorkspacePlanner({ discover });
  const workspaceExecutor =
    executor ?? new GitWorkspaceExecutor({ discover, planner: workspacePlanner });

  if (!workspacePlanner || typeof workspacePlanner.plan !== 'function') {
    throw new TypeError('Git IPC workspace planner must provide a plan function.');
  }

  if (
    !workspaceExecutor ||
    typeof workspaceExecutor.attachWorktree !== 'function' ||
    typeof workspaceExecutor.createExistingBranch !== 'function' ||
    typeof workspaceExecutor.createNewBranch !== 'function'
  ) {
    throw new TypeError('Git IPC workspace executor must provide all assignment functions.');
  }

  const getTerminalProjectPath = (id) => {
    if (typeof id !== 'string' || !workspaceService.has(id)) {
      throw new Error('Invalid terminal Git discovery id.');
    }

    return workspaceService.getCurrentFolder(id);
  };

  const handleDiscover = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git discovery request.');
    }

    const { id } = payload ?? {};

    const projectPath = getTerminalProjectPath(id);

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

  const handlePlanWorkspace = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git workspace preview request.');
    }

    const { id, request } = payload ?? {};
    const projectPath = getTerminalProjectPath(id);

    if (!projectPath) {
      return {
        error: {
          code: 'PROJECT_FOLDER_UNAVAILABLE',
          message: 'Select an accessible Git project folder before planning a worktree.',
        },
        id,
        ok: false,
      };
    }

    writeLog(logger, 'info', 'git.workspace_preview_requested', { terminalId: id });

    try {
      const preview = await workspacePlanner.plan({
        assignedWorktrees: workspaceService.getAssignedGitWorktrees?.(id) ?? [],
        projectPath,
        request,
        terminalId: id,
      });
      writeLog(logger, 'info', 'git.workspace_preview_succeeded', {
        operationId: preview.operationId,
        terminalId: id,
      });
      return { id, ok: true, preview };
    } catch (error) {
      const errorPayload = toGitWorkspacePlanErrorPayload(error);
      writeLog(logger, 'warn', 'git.workspace_preview_failed', {
        error: { code: errorPayload.code },
        terminalId: id,
      });
      return { error: errorPayload, id, ok: false };
    }
  };

  const createConfirmationHandler = (executorMethod, operationName) => async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git workspace confirmation request.');
    }

    const { id, operationId } = payload ?? {};
    const projectPath = getTerminalProjectPath(id);

    if (typeof operationId !== 'string' || operationId.length > 100) {
      throw new Error('Invalid Git workspace operation id.');
    }

    writeLog(logger, 'info', `git.workspace_${operationName}_requested`, {
      operationId,
      terminalId: id,
    });

    try {
      const operation = await workspaceExecutor[executorMethod]({
        assignedWorktrees: workspaceService.getAssignedGitWorktrees?.(id) ?? [],
        commitAssignment: (workspace) => workspaceService.assignGitWorktree(id, workspace),
        getAssignedWorktrees: () => workspaceService.getAssignedGitWorktrees?.(id) ?? [],
        operationId,
        projectPath,
        terminalId: id,
      });
      let session = null;
      let terminalError = null;

      try {
        session = await startTerminal(id);
      } catch (error) {
        terminalError = {
          code: 'TERMINAL_START_FAILED',
          message:
            'The workspace was assigned, but Codex could not start. Verify Codex in a normal terminal and retry.',
        };
        writeLog(logger, 'error', 'git.workspace_terminal_start_failed', {
          error,
          operationId,
          terminalId: id,
        });
      }

      writeLog(logger, 'info', `git.workspace_${operationName}_succeeded`, {
        operationId,
        terminalId: id,
      });
      return { id, ok: true, operation, session, terminalError };
    } catch (error) {
      const errorPayload =
        error instanceof GitWorkspaceExecutionError
          ? toGitWorkspaceExecutionErrorPayload(error)
          : toGitWorkspacePlanErrorPayload(error);
      writeLog(logger, 'error', `git.workspace_${operationName}_failed`, {
        error: { code: errorPayload.code },
        operationId,
        terminalId: id,
      });
      return { error: errorPayload, id, ok: false };
    }
  };

  const handleAttachWorktree = createConfirmationHandler('attachWorktree', 'attach');
  const handleCreateExistingBranch = createConfirmationHandler(
    'createExistingBranch',
    'create_existing',
  );
  const handleCreateNewBranch = createConfirmationHandler('createNewBranch', 'create_new');

  ipcMain.handle(GIT_CHANNELS.attachWorktree, handleAttachWorktree);
  ipcMain.handle(GIT_CHANNELS.createExistingBranch, handleCreateExistingBranch);
  ipcMain.handle(GIT_CHANNELS.createNewBranch, handleCreateNewBranch);
  ipcMain.handle(GIT_CHANNELS.discover, handleDiscover);
  ipcMain.handle(GIT_CHANNELS.planWorkspace, handlePlanWorkspace);

  return () => {
    workspacePlanner.clearPreviews?.();
    ipcMain.removeHandler(GIT_CHANNELS.attachWorktree);
    ipcMain.removeHandler(GIT_CHANNELS.createExistingBranch);
    ipcMain.removeHandler(GIT_CHANNELS.createNewBranch);
    ipcMain.removeHandler(GIT_CHANNELS.discover);
    ipcMain.removeHandler(GIT_CHANNELS.planWorkspace);
  };
};

module.exports = {
  isTrustedEvent,
  registerGitIpc,
};
