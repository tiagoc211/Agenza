const { discoverGitRepository } = require('./git-discovery');
const { toGitErrorPayload } = require('./git-command');
const { addGitRecovery } = require('./git-error-guidance');
const { writeGitLifecycleLog } = require('./git-lifecycle-log');
const {
  GitWorkspaceExecutionError,
  GitWorkspaceExecutor,
  toGitWorkspaceExecutionErrorPayload,
} = require('./git-workspace-executor');
const { GitWorkspacePlanner, toGitWorkspacePlanErrorPayload } = require('./git-workspace-planner');
const { readGitWorkspaceStatus } = require('./git-status');
const { GitWorktreeCleanup, toGitWorktreeCleanupErrorPayload } = require('./git-worktree-cleanup');
const { GIT_CHANNELS } = require('./ipc-channels');

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const registerGitIpc = ({
  discover = discoverGitRepository,
  cleanup,
  ipcMain,
  logger,
  executor,
  planner,
  readStatus,
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
  const worktreeCleanup =
    cleanup ??
    new GitWorktreeCleanup({
      discover,
      enqueueRepository: (repositoryRoot, operation) =>
        workspaceExecutor.enqueueRepository(repositoryRoot, operation),
    });
  const statusReader =
    readStatus ?? ((projectPath) => readGitWorkspaceStatus(projectPath, { discover }));

  if (typeof statusReader !== 'function') {
    throw new TypeError('Git IPC status reader must be a function.');
  }

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

  if (
    !worktreeCleanup ||
    typeof worktreeCleanup.preview !== 'function' ||
    typeof worktreeCleanup.confirm !== 'function'
  ) {
    throw new TypeError('Git IPC worktree cleanup must provide preview and confirm functions.');
  }

  const getTerminalProjectPath = (id, { allowRecovery = false } = {}) => {
    if (typeof id !== 'string' || !workspaceService.has(id)) {
      throw new Error('Invalid terminal Git discovery id.');
    }

    if (allowRecovery && typeof workspaceService.getGitInspectionFolder === 'function') {
      return workspaceService.getGitInspectionFolder(id);
    }

    return workspaceService.getCurrentFolder(id);
  };

  const handleDiscover = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git discovery request.');
    }

    const { id } = payload ?? {};

    const projectPath = getTerminalProjectPath(id, { allowRecovery: true });

    if (!projectPath) {
      const error = addGitRecovery({
        code: 'PROJECT_FOLDER_UNAVAILABLE',
        message: 'Select an accessible project folder before inspecting Git.',
      });
      writeGitLifecycleLog(logger, 'warn', 'git.discovery_blocked', {
        errorCode: error.code,
        terminalId: id,
        workspaceState: 'blocked',
      });
      return {
        error,
        id,
        ok: false,
      };
    }

    writeGitLifecycleLog(logger, 'info', 'git.discovery_requested', {
      terminalId: id,
      workspaceState: 'available',
    });

    try {
      const repository = await discover(projectPath);
      writeGitLifecycleLog(logger, 'info', 'git.discovery_succeeded', {
        terminalId: id,
        workspaceState: 'discovered',
      });
      return { id, ok: true, repository };
    } catch (error) {
      const errorPayload = addGitRecovery(toGitErrorPayload(error));
      writeGitLifecycleLog(logger, 'warn', 'git.discovery_failed', {
        errorCode: errorPayload.code,
        terminalId: id,
        workspaceState: 'failed',
      });
      return { error: errorPayload, id, ok: false };
    }
  };

  const handlePlanWorkspace = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git workspace preview request.');
    }

    const { id, request } = payload ?? {};
    const projectPath = getTerminalProjectPath(id, { allowRecovery: true });

    if (!projectPath) {
      const error = addGitRecovery({
        code: 'PROJECT_FOLDER_UNAVAILABLE',
        message: 'Select an accessible Git project folder before planning a worktree.',
      });
      writeGitLifecycleLog(logger, 'warn', 'git.workspace_preview_blocked', {
        errorCode: error.code,
        operationType: 'preview',
        terminalId: id,
        workspaceState: 'blocked',
      });
      return {
        error,
        id,
        ok: false,
      };
    }

    writeGitLifecycleLog(logger, 'info', 'git.workspace_preview_requested', {
      operationType: 'preview',
      terminalId: id,
      workspaceState: 'available',
    });

    try {
      const preview = await workspacePlanner.plan({
        assignedWorktrees: workspaceService.getAssignedGitWorktrees?.(id) ?? [],
        projectPath,
        request,
        terminalId: id,
      });
      writeGitLifecycleLog(logger, 'info', 'git.workspace_preview_succeeded', {
        operationId: preview.operationId,
        operationType: 'preview',
        terminalId: id,
        workspaceState: 'previewed',
      });
      return { id, ok: true, preview };
    } catch (error) {
      const errorPayload = addGitRecovery(toGitWorkspacePlanErrorPayload(error));
      writeGitLifecycleLog(logger, 'warn', 'git.workspace_preview_failed', {
        errorCode: errorPayload.code,
        operationType: 'preview',
        terminalId: id,
        workspaceState: 'failed',
      });
      return { error: errorPayload, id, ok: false };
    }
  };

  const handleStatus = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git status request.');
    }

    const { id } = payload ?? {};
    getTerminalProjectPath(id);
    let workspaceSnapshot = null;

    try {
      workspaceSnapshot =
        typeof workspaceService.refreshWorkspace === 'function'
          ? await workspaceService.refreshWorkspace(id)
          : null;
    } catch {
      const error = addGitRecovery({
        code: 'GIT_WORKSPACE_REFRESH_FAILED',
        message: 'Agenza could not refresh this saved workspace safely.',
      });
      writeGitLifecycleLog(logger, 'warn', 'git.status_failed', {
        errorCode: error.code,
        operationType: 'status',
        terminalId: id,
        workspaceState: 'failed',
      });
      return { error, id, ok: false };
    }

    const projectPath = getTerminalProjectPath(id);

    if (!projectPath) {
      const error = addGitRecovery({
        code: workspaceSnapshot?.workspaceStatus?.code ?? 'PROJECT_FOLDER_UNAVAILABLE',
        message:
          workspaceSnapshot?.workspaceStatus?.message ??
          'Select an accessible project folder before refreshing Git status.',
      });
      const result = {
        error,
        id,
        ok: false,
      };

      if (workspaceSnapshot?.workspaceStatus) {
        result.workspaceStatus = workspaceSnapshot.workspaceStatus;
      }

      writeGitLifecycleLog(logger, 'warn', 'git.status_blocked', {
        errorCode: error.code,
        operationType: 'status',
        terminalId: id,
        workspaceState: workspaceSnapshot?.workspaceStatus ? 'stale' : 'blocked',
      });
      return result;
    }

    writeGitLifecycleLog(logger, 'info', 'git.status_requested', {
      operationType: 'status',
      terminalId: id,
      workspaceState: 'available',
    });

    try {
      const status = await statusReader(projectPath);
      const workspaceState =
        status.changes?.conflicted > 0 ? 'conflicted' : status.changes?.isClean ? 'clean' : 'dirty';
      writeGitLifecycleLog(logger, 'info', 'git.status_succeeded', {
        operationType: 'status',
        terminalId: id,
        workspaceState,
      });
      return {
        id,
        ok: true,
        status,
        ...(workspaceSnapshot?.workspaceStatus
          ? { workspaceStatus: workspaceSnapshot.workspaceStatus }
          : {}),
      };
    } catch (error) {
      const errorPayload = addGitRecovery(toGitErrorPayload(error));
      writeGitLifecycleLog(logger, 'warn', 'git.status_failed', {
        errorCode: errorPayload.code,
        operationType: 'status',
        terminalId: id,
        workspaceState: 'failed',
      });
      return { error: errorPayload, id, ok: false };
    }
  };

  const handleListManagedWorktrees = async (event) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted managed worktree request.');
    }

    return { ok: true, worktrees: workspaceService.getManagedWorktrees?.() ?? [] };
  };

  const handlePreviewCleanup = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted worktree cleanup preview request.');
    }

    const { creationId } = payload ?? {};
    writeGitLifecycleLog(logger, 'info', 'git.worktree_cleanup_preview_requested', {
      creationId,
      operationType: 'cleanup',
      workspaceState: 'available',
    });

    try {
      const preview = await worktreeCleanup.preview({
        assignedWorktrees: workspaceService.getAssignedGitWorktrees?.() ?? [],
        creationId,
        getManagedWorktree: (id) => workspaceService.getManagedWorktree?.(id) ?? null,
      });
      writeGitLifecycleLog(logger, 'info', 'git.worktree_cleanup_preview_succeeded', {
        creationId,
        operationId: preview.operationId,
        operationType: 'cleanup',
        workspaceState: 'previewed',
      });
      return { ok: true, preview };
    } catch (error) {
      const errorPayload = addGitRecovery(toGitWorktreeCleanupErrorPayload(error));
      writeGitLifecycleLog(logger, 'warn', 'git.worktree_cleanup_preview_failed', {
        creationId,
        errorCode: errorPayload.code,
        operationType: 'cleanup',
        workspaceState: 'failed',
      });
      return { error: errorPayload, ok: false };
    }
  };

  const handleConfirmCleanup = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted worktree cleanup confirmation request.');
    }

    const { operationId } = payload ?? {};
    writeGitLifecycleLog(logger, 'info', 'git.worktree_cleanup_requested', {
      operationId,
      operationType: 'cleanup',
      workspaceState: 'available',
    });

    try {
      const operation = await worktreeCleanup.confirm({
        forgetManagedWorktree: (creationId) => workspaceService.forgetManagedWorktree(creationId),
        getAssignedWorktrees: () => workspaceService.getAssignedGitWorktrees?.() ?? [],
        getManagedWorktree: (creationId) =>
          workspaceService.getManagedWorktree?.(creationId) ?? null,
        operationId,
      });
      writeGitLifecycleLog(logger, 'info', 'git.worktree_cleanup_succeeded', {
        creationId: operation.creationId,
        operationId,
        operationType: 'cleanup',
        workspaceState: 'succeeded',
      });
      return { ok: true, operation };
    } catch (error) {
      const errorPayload = addGitRecovery(toGitWorktreeCleanupErrorPayload(error));
      writeGitLifecycleLog(logger, 'warn', 'git.worktree_cleanup_failed', {
        errorCode: errorPayload.code,
        operationId,
        operationType: 'cleanup',
        workspaceState: 'failed',
      });
      return { error: errorPayload, ok: false };
    }
  };

  const handleForgetStaleCleanupRecord = async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted stale cleanup record request.');
    }

    const { creationId } = payload ?? {};
    writeGitLifecycleLog(logger, 'info', 'git.worktree_cleanup_stale_record_forget_requested', {
      creationId,
      operationType: 'cleanup',
      workspaceState: 'stale',
    });

    try {
      const operation = await worktreeCleanup.forgetStaleRecord({
        creationId,
        forgetManagedWorktree: (id) => workspaceService.forgetManagedWorktree(id),
        getAssignedWorktrees: () => workspaceService.getAssignedGitWorktrees?.() ?? [],
        getManagedWorktree: (id) => workspaceService.getManagedWorktree?.(id) ?? null,
      });
      writeGitLifecycleLog(logger, 'info', 'git.worktree_cleanup_stale_record_forget_succeeded', {
        creationId: operation.creationId,
        operationType: 'cleanup',
        workspaceState: 'succeeded',
      });
      return { ok: true, operation };
    } catch (error) {
      const errorPayload = addGitRecovery(toGitWorktreeCleanupErrorPayload(error));
      writeGitLifecycleLog(logger, 'warn', 'git.worktree_cleanup_stale_record_forget_failed', {
        creationId,
        errorCode: errorPayload.code,
        operationType: 'cleanup',
        workspaceState: 'failed',
      });
      return { error: errorPayload, ok: false };
    }
  };

  const createConfirmationHandler = (executorMethod, operationName) => async (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted Git workspace confirmation request.');
    }

    const { id, operationId } = payload ?? {};
    const projectPath = getTerminalProjectPath(id, { allowRecovery: true });

    if (typeof operationId !== 'string' || operationId.length > 100) {
      throw new Error('Invalid Git workspace operation id.');
    }

    writeGitLifecycleLog(logger, 'info', `git.workspace_${operationName}_requested`, {
      operationId,
      operationType: operationName,
      terminalId: id,
      workspaceState: 'available',
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
      } catch {
        terminalError = addGitRecovery({
          code: 'TERMINAL_START_FAILED',
          message: 'The workspace was assigned, but Codex could not start.',
        });
        writeGitLifecycleLog(logger, 'error', 'git.workspace_terminal_start_failed', {
          errorCode: terminalError.code,
          operationId,
          operationType: operationName,
          terminalId: id,
          workspaceState: 'failed',
        });
      }

      writeGitLifecycleLog(logger, 'info', `git.workspace_${operationName}_succeeded`, {
        operationId,
        operationType: operationName,
        ownershipKind: operation.workspace?.repository?.worktree?.ownership?.kind,
        terminalId: id,
        workspaceState: 'succeeded',
      });
      return { id, ok: true, operation, session, terminalError };
    } catch (error) {
      const errorPayload = addGitRecovery(
        error instanceof GitWorkspaceExecutionError
          ? toGitWorkspaceExecutionErrorPayload(error)
          : toGitWorkspacePlanErrorPayload(error),
      );
      writeGitLifecycleLog(logger, 'error', `git.workspace_${operationName}_failed`, {
        errorCode: errorPayload.code,
        operationId,
        operationType: operationName,
        rollbackState: errorPayload.rollbackState,
        terminalId: id,
        workspaceState: 'failed',
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
  ipcMain.handle(GIT_CHANNELS.confirmCleanup, handleConfirmCleanup);
  ipcMain.handle(GIT_CHANNELS.createExistingBranch, handleCreateExistingBranch);
  ipcMain.handle(GIT_CHANNELS.createNewBranch, handleCreateNewBranch);
  ipcMain.handle(GIT_CHANNELS.discover, handleDiscover);
  ipcMain.handle(GIT_CHANNELS.forgetStaleCleanupRecord, handleForgetStaleCleanupRecord);
  ipcMain.handle(GIT_CHANNELS.listManagedWorktrees, handleListManagedWorktrees);
  ipcMain.handle(GIT_CHANNELS.planWorkspace, handlePlanWorkspace);
  ipcMain.handle(GIT_CHANNELS.previewCleanup, handlePreviewCleanup);
  ipcMain.handle(GIT_CHANNELS.status, handleStatus);

  return () => {
    workspacePlanner.clearPreviews?.();
    worktreeCleanup.clearPreviews?.();
    ipcMain.removeHandler(GIT_CHANNELS.attachWorktree);
    ipcMain.removeHandler(GIT_CHANNELS.confirmCleanup);
    ipcMain.removeHandler(GIT_CHANNELS.createExistingBranch);
    ipcMain.removeHandler(GIT_CHANNELS.createNewBranch);
    ipcMain.removeHandler(GIT_CHANNELS.discover);
    ipcMain.removeHandler(GIT_CHANNELS.forgetStaleCleanupRecord);
    ipcMain.removeHandler(GIT_CHANNELS.listManagedWorktrees);
    ipcMain.removeHandler(GIT_CHANNELS.planWorkspace);
    ipcMain.removeHandler(GIT_CHANNELS.previewCleanup);
    ipcMain.removeHandler(GIT_CHANNELS.status);
  };
};

module.exports = {
  isTrustedEvent,
  registerGitIpc,
};
