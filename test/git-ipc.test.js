const assert = require('node:assert/strict');
const test = require('node:test');

const { GIT_ERROR_CODES, GitDiscoveryError } = require('../src/git/git-command');
const {
  GIT_EXECUTION_ERROR_CODES,
  GitWorkspaceExecutionError,
} = require('../src/git/git-workspace-executor');
const { registerGitIpc } = require('../src/git/git-ipc');
const { getGitRecoveryAction } = require('../src/git/git-error-guidance');
const { fingerprintIdentifier } = require('../src/git/git-lifecycle-log');
const { GIT_CHANNELS } = require('../src/git/ipc-channels');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }
}

const createHarness = ({
  currentFolder = 'C:\\repo',
  discoveryError = null,
  executionError = null,
  planError = null,
  recoveryFolder = null,
  recoveryStatus = null,
  statusError = null,
  terminalStartError = null,
} = {}) => {
  const ipcMain = new FakeIpcMain();
  const logs = [];
  const mainFrame = {};
  const webContents = { mainFrame };
  const repository = {
    branches: [],
    currentBranch: 'main',
    root: 'C:\\repo',
    worktrees: [],
  };
  const planRequests = [];
  const executionRequests = [];
  const startedIds = [];
  const statusRequests = [];
  const assignedWorkspaces = [];
  const cleanupRequests = [];
  const forgottenWorktrees = [];
  const managedWorktree = {
    assignedTerminalId: null,
    branchRef: 'refs/heads/agent-one',
    creationId: 'worktree-one',
    path: 'C:\\repo-agent-one',
    repositoryRoot: 'C:\\repo',
  };
  const preview = {
    baseBranch: 'main',
    operationId: 'operation-one',
    repositoryRoot: 'C:\\repo',
    targetBranch: 'agent-one',
    worktreePath: 'C:\\repo-agent-one',
  };
  const workspace = {
    kind: 'git-worktree',
    projectPath: 'C:\\repo-agent-one',
    repository: {
      branch: 'refs/heads/agent-one',
      root: 'C:\\repo',
      worktree: {
        ownership: { creationId: 'worktree-one', kind: 'agenza' },
        path: 'C:\\repo-agent-one',
      },
    },
  };
  const gitStatus = {
    branch: 'main',
    branchRef: 'refs/heads/main',
    changes: { conflicted: 0, isClean: true, tracked: 0, untracked: 0 },
    detached: false,
    repositoryRoot: 'C:\\repo',
    worktreePath: 'C:\\repo',
  };
  const executeWorkspace = (method) => async (request) => {
    executionRequests.push({ method, ...request });

    if (executionError) {
      throw executionError;
    }

    const workspaceSnapshot = await request.commitAssignment(workspace);
    return {
      operationId: request.operationId,
      state: 'succeeded',
      workspace,
      workspaceSnapshot,
    };
  };
  const dispose = registerGitIpc({
    cleanup: {
      clearPreviews: () => {},
      confirm: async (request) => {
        cleanupRequests.push({ method: 'confirm', ...request });
        await request.forgetManagedWorktree(managedWorktree.creationId);
        return {
          branchPreserved: true,
          ...managedWorktree,
          operationId: request.operationId,
          state: 'succeeded',
          worktreePath: managedWorktree.path,
        };
      },
      preview: async (request) => {
        cleanupRequests.push({ method: 'preview', ...request });
        return {
          branchRef: managedWorktree.branchRef,
          creationId: request.creationId,
          operationId: 'cleanup-one',
          repositoryRoot: managedWorktree.repositoryRoot,
          worktreePath: managedWorktree.path,
        };
      },
    },
    discover: async () => {
      if (discoveryError) {
        throw discoveryError;
      }

      return repository;
    },
    executor: {
      attachWorktree: executeWorkspace('attachWorktree'),
      createExistingBranch: executeWorkspace('createExistingBranch'),
      createNewBranch: executeWorkspace('createNewBranch'),
    },
    ipcMain,
    logger: {
      error: (event, details) => logs.push({ details, event, level: 'error' }),
      info: (event, details) => logs.push({ details, event, level: 'info' }),
      warn: (event, details) => logs.push({ details, event, level: 'warn' }),
    },
    planner: {
      plan: async (request) => {
        planRequests.push(request);

        if (planError) {
          throw planError;
        }

        return preview;
      },
    },
    readStatus: async (projectPath) => {
      statusRequests.push(projectPath);
      const error = typeof statusError === 'function' ? statusError(projectPath) : statusError;

      if (error) {
        throw error;
      }

      return { ...gitStatus, worktreePath: projectPath };
    },
    startTerminal: async (id) => {
      startedIds.push(id);

      if (terminalStartError) {
        throw terminalStartError;
      }

      return { id, isRunning: true, pid: 123 };
    },
    window: { webContents },
    workspaceService: {
      assignGitWorktree: async (id, assignedWorkspace) => {
        assignedWorkspaces.push({ id, workspace: assignedWorkspace });
        return { id, workspace: assignedWorkspace };
      },
      getAssignedGitWorktrees: (id) => [
        {
          path: 'C:\\assigned',
          terminalId: id === 'terminal-one' ? 'terminal-two' : 'terminal-one',
        },
      ],
      forgetManagedWorktree: async (creationId) => forgottenWorktrees.push(creationId),
      getManagedWorktree: (creationId) =>
        creationId === managedWorktree.creationId ? managedWorktree : null,
      getManagedWorktrees: () => [managedWorktree],
      ...(recoveryStatus
        ? {
            getGitInspectionFolder: () => recoveryFolder,
            refreshWorkspace: async () => ({ workspaceStatus: recoveryStatus }),
          }
        : {}),
      getCurrentFolder: (id) =>
        typeof currentFolder === 'function' ? currentFolder(id) : currentFolder,
      has: (id) => id === 'terminal-one' || id === 'terminal-two',
    },
  });

  return {
    assignedWorkspaces,
    cleanupRequests,
    discover: ipcMain.handlers.get(GIT_CHANNELS.discover),
    dispose,
    executionRequests,
    forgottenWorktrees,
    ipcMain,
    logs,
    managedWorktree,
    planRequests,
    preview,
    repository,
    startedIds,
    status: ipcMain.handlers.get(GIT_CHANNELS.status),
    statusRequests,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
    workspace,
  };
};

test('discovers Git only for the selected folder belonging to the requesting terminal', async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.discover(harness.trustedEvent, { id: 'terminal-one' }), {
    id: 'terminal-one',
    ok: true,
    repository: harness.repository,
  });
  await assert.rejects(
    harness.discover({ sender: {}, senderFrame: {} }, { id: 'terminal-one' }),
    /Untrusted/,
  );
  await assert.rejects(
    harness.discover(harness.trustedEvent, { id: 'terminal-unknown' }),
    /Invalid terminal Git discovery id/,
  );
  assert.deepEqual(harness.logs, [
    {
      details: {
        terminal: fingerprintIdentifier('terminal', 'terminal-one'),
        workspaceState: 'available',
      },
      event: 'git.discovery_requested',
      level: 'info',
    },
    {
      details: {
        terminal: fingerprintIdentifier('terminal', 'terminal-one'),
        workspaceState: 'discovered',
      },
      event: 'git.discovery_succeeded',
      level: 'info',
    },
  ]);

  harness.dispose();
  assert.equal(harness.ipcMain.handlers.size, 0);
});

test('refreshes read-only Git status only for the requesting terminal folder', async () => {
  const harness = createHarness({
    currentFolder: (id) => `C:\\${id}`,
  });
  const result = await harness.status(harness.trustedEvent, { id: 'terminal-two' });

  assert.equal(result.ok, true);
  assert.equal(result.id, 'terminal-two');
  assert.equal(result.status.worktreePath, 'C:\\terminal-two');
  assert.deepEqual(harness.statusRequests, ['C:\\terminal-two']);
  assert.deepEqual(harness.startedIds, []);
  await assert.rejects(
    harness.status({ sender: {}, senderFrame: {} }, { id: 'terminal-two' }),
    /Untrusted/,
  );

  harness.dispose();
});

test('keeps a Git status failure local while another terminal can refresh', async () => {
  const harness = createHarness({
    currentFolder: (id) => `C:\\${id}`,
    statusError: (projectPath) =>
      projectPath.endsWith('terminal-one') ? new GitDiscoveryError(GIT_ERROR_CODES.timeout) : null,
  });
  const first = await harness.status(harness.trustedEvent, { id: 'terminal-one' });
  const second = await harness.status(harness.trustedEvent, { id: 'terminal-two' });

  assert.equal(first.ok, false);
  assert.equal(first.id, 'terminal-one');
  assert.equal(first.error.code, GIT_ERROR_CODES.timeout);
  assert.equal(first.error.recovery, getGitRecoveryAction(GIT_ERROR_CODES.timeout));
  assert.equal(second.ok, true);
  assert.equal(second.id, 'terminal-two');
  assert.deepEqual(harness.statusRequests, ['C:\\terminal-one', 'C:\\terminal-two']);

  harness.dispose();
});

test('returns refreshed stale metadata and uses only its recovery root for reassignment discovery', async () => {
  const recoveryStatus = {
    branch: 'refs/heads/agent-one',
    candidatePath: 'C:\\repo-agent-moved',
    code: 'SAVED_GIT_WORKTREE_MOVED',
    message: 'The saved worktree moved.',
    path: 'C:\\repo-agent-old',
    recoveryPath: 'C:\\repo',
    repositoryRoot: 'C:\\repo',
    status: 'stale',
  };
  const harness = createHarness({
    currentFolder: null,
    recoveryFolder: 'C:\\repo',
    recoveryStatus,
  });
  const statusResult = await harness.status(harness.trustedEvent, { id: 'terminal-one' });
  const discoveryResult = await harness.discover(harness.trustedEvent, { id: 'terminal-one' });

  assert.deepEqual(statusResult, {
    error: {
      code: recoveryStatus.code,
      message: recoveryStatus.message,
      recovery: getGitRecoveryAction(recoveryStatus.code),
    },
    id: 'terminal-one',
    ok: false,
    workspaceStatus: recoveryStatus,
  });
  assert.equal(discoveryResult.ok, true);
  assert.equal(discoveryResult.repository, harness.repository);
  assert.deepEqual(harness.statusRequests, []);

  harness.dispose();
});

test('lists, previews, and confirms only the recorded managed worktree cleanup', async () => {
  const harness = createHarness();
  const listManaged = harness.ipcMain.handlers.get(GIT_CHANNELS.listManagedWorktrees);
  const previewCleanup = harness.ipcMain.handlers.get(GIT_CHANNELS.previewCleanup);
  const confirmCleanup = harness.ipcMain.handlers.get(GIT_CHANNELS.confirmCleanup);

  assert.deepEqual(await listManaged(harness.trustedEvent), {
    ok: true,
    worktrees: [harness.managedWorktree],
  });
  const previewResult = await previewCleanup(harness.trustedEvent, {
    creationId: harness.managedWorktree.creationId,
  });
  assert.equal(previewResult.ok, true);
  assert.equal(previewResult.preview.operationId, 'cleanup-one');
  assert.equal(harness.cleanupRequests[0].method, 'preview');
  assert.deepEqual(harness.cleanupRequests[0].assignedWorktrees, [
    { path: 'C:\\assigned', terminalId: 'terminal-one' },
  ]);

  const confirmResult = await confirmCleanup(harness.trustedEvent, {
    operationId: 'cleanup-one',
  });
  assert.equal(confirmResult.ok, true);
  assert.equal(confirmResult.operation.branchPreserved, true);
  assert.deepEqual(harness.forgottenWorktrees, [harness.managedWorktree.creationId]);
  await assert.rejects(
    previewCleanup(
      { sender: {}, senderFrame: {} },
      {
        creationId: harness.managedWorktree.creationId,
      },
    ),
    /Untrusted/,
  );

  harness.dispose();
});

test('returns a terminal-scoped immutable workspace preview before confirmation', async () => {
  const harness = createHarness();
  const planWorkspace = harness.ipcMain.handlers.get(GIT_CHANNELS.planWorkspace);
  const request = {
    baseBranch: 'main',
    targetBranch: 'agent-one',
    type: 'create-new-branch-worktree',
    worktreePath: 'C:\\repo-agent-one',
  };

  assert.deepEqual(await planWorkspace(harness.trustedEvent, { id: 'terminal-one', request }), {
    id: 'terminal-one',
    ok: true,
    preview: harness.preview,
  });
  assert.deepEqual(harness.planRequests, [
    {
      assignedWorktrees: [{ path: 'C:\\assigned', terminalId: 'terminal-two' }],
      projectPath: 'C:\\repo',
      request,
      terminalId: 'terminal-one',
    },
  ]);
  await assert.rejects(
    planWorkspace({ sender: {}, senderFrame: {} }, { id: 'terminal-one', request }),
    /Untrusted/,
  );

  harness.dispose();
});

test('confirms one preview, persists its workspace, and starts only the owning terminal', async () => {
  const harness = createHarness();
  const createNewBranch = harness.ipcMain.handlers.get(GIT_CHANNELS.createNewBranch);
  const result = await createNewBranch(harness.trustedEvent, {
    id: 'terminal-one',
    operationId: 'operation-one',
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, 'terminal-one');
  assert.equal(result.operation.state, 'succeeded');
  assert.deepEqual(result.session, { id: 'terminal-one', isRunning: true, pid: 123 });
  assert.equal(result.terminalError, null);
  assert.deepEqual(harness.assignedWorkspaces, [
    { id: 'terminal-one', workspace: harness.workspace },
  ]);
  assert.deepEqual(harness.startedIds, ['terminal-one']);
  assert.equal(harness.executionRequests[0].terminalId, 'terminal-one');
  assert.equal(harness.executionRequests[0].method, 'createNewBranch');
  assert.deepEqual(harness.executionRequests[0].assignedWorktrees, [
    { path: 'C:\\assigned', terminalId: 'terminal-two' },
  ]);
  await assert.rejects(
    createNewBranch(
      { sender: {}, senderFrame: {} },
      { id: 'terminal-one', operationId: 'operation-one' },
    ),
    /Untrusted/,
  );

  harness.dispose();
});

test('confirms existing branches and worktrees through their distinct narrow operations', async () => {
  for (const [channel, method] of [
    [GIT_CHANNELS.createExistingBranch, 'createExistingBranch'],
    [GIT_CHANNELS.attachWorktree, 'attachWorktree'],
  ]) {
    const harness = createHarness();
    const confirm = harness.ipcMain.handlers.get(channel);
    const result = await confirm(harness.trustedEvent, {
      id: 'terminal-two',
      operationId: 'operation-one',
    });

    assert.equal(result.ok, true);
    assert.equal(harness.executionRequests[0].method, method);
    assert.equal(harness.executionRequests[0].terminalId, 'terminal-two');
    assert.deepEqual(await harness.executionRequests[0].getAssignedWorktrees(), [
      { path: 'C:\\assigned', terminalId: 'terminal-one' },
    ]);
    assert.deepEqual(harness.startedIds, ['terminal-two']);
    assert.deepEqual(harness.assignedWorkspaces, [
      { id: 'terminal-two', workspace: harness.workspace },
    ]);

    harness.dispose();
  }
});

test('reports rollback failures and keeps a completed workspace when only Codex startup fails', async () => {
  const failedMutation = createHarness({
    executionError: new GitWorkspaceExecutionError(GIT_EXECUTION_ERROR_CODES.createFailed, {
      operationId: 'operation-one',
      rollbackState: 'rolled-back',
    }),
  });
  const failedStart = createHarness({ terminalStartError: new Error('Codex unavailable') });
  const confirmMutation = failedMutation.ipcMain.handlers.get(GIT_CHANNELS.createNewBranch);
  const confirmStart = failedStart.ipcMain.handlers.get(GIT_CHANNELS.createNewBranch);
  const payload = { id: 'terminal-one', operationId: 'operation-one' };
  const mutationResult = await confirmMutation(failedMutation.trustedEvent, payload);
  const startResult = await confirmStart(failedStart.trustedEvent, payload);

  assert.equal(mutationResult.ok, false);
  assert.equal(mutationResult.error.code, GIT_EXECUTION_ERROR_CODES.createFailed);
  assert.equal(
    mutationResult.error.recovery,
    getGitRecoveryAction(GIT_EXECUTION_ERROR_CODES.createFailed),
  );
  assert.equal(mutationResult.error.rollbackState, 'rolled-back');
  assert.deepEqual(failedMutation.startedIds, []);
  assert.equal(startResult.ok, true);
  assert.equal(startResult.session, null);
  assert.equal(startResult.terminalError.code, 'TERMINAL_START_FAILED');
  assert.equal(startResult.terminalError.recovery, getGitRecoveryAction('TERMINAL_START_FAILED'));
  assert.deepEqual(failedStart.assignedWorkspaces, [
    { id: 'terminal-one', workspace: failedStart.workspace },
  ]);
  const serializedLogs = JSON.stringify(failedStart.logs);
  assert.equal(serializedLogs.includes('Codex unavailable'), false);
  assert.equal(serializedLogs.includes('terminal-one'), false);
  assert.equal(serializedLogs.includes('operation-one'), false);
  assert.equal(serializedLogs.includes('C:\\repo'), false);
  assert.match(serializedLogs, /TERMINAL_START_FAILED/);

  failedMutation.dispose();
  failedStart.dispose();
});

test('returns concise terminal-local errors for unavailable folders and Git failures', async () => {
  const unavailable = createHarness({ currentFolder: null });
  const missingGit = createHarness({
    discoveryError: new GitDiscoveryError(GIT_ERROR_CODES.missing),
  });

  assert.deepEqual(await unavailable.discover(unavailable.trustedEvent, { id: 'terminal-one' }), {
    error: {
      code: 'PROJECT_FOLDER_UNAVAILABLE',
      message: 'Select an accessible project folder before inspecting Git.',
      recovery: getGitRecoveryAction('PROJECT_FOLDER_UNAVAILABLE'),
    },
    id: 'terminal-one',
    ok: false,
  });
  const firstFailure = await missingGit.discover(missingGit.trustedEvent, { id: 'terminal-one' });
  const secondSuccess = await missingGit.discover(missingGit.trustedEvent, { id: 'terminal-two' });

  assert.equal(firstFailure.id, 'terminal-one');
  assert.equal(firstFailure.ok, false);
  assert.equal(firstFailure.error.code, GIT_ERROR_CODES.missing);
  assert.match(firstFailure.error.message, /Install Git/);
  assert.equal(firstFailure.error.recovery, getGitRecoveryAction(GIT_ERROR_CODES.missing));
  assert.equal(secondSuccess.id, 'terminal-two');
  assert.equal(secondSuccess.ok, false);
  assert.equal(secondSuccess.error.code, GIT_ERROR_CODES.missing);

  unavailable.dispose();
  missingGit.dispose();
});
