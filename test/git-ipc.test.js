const assert = require('node:assert/strict');
const test = require('node:test');

const { GIT_ERROR_CODES, GitDiscoveryError } = require('../src/git/git-command');
const {
  GIT_EXECUTION_ERROR_CODES,
  GitWorkspaceExecutionError,
} = require('../src/git/git-workspace-executor');
const { registerGitIpc } = require('../src/git/git-ipc');
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
  const assignedWorkspaces = [];
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
      getCurrentFolder: () => currentFolder,
      has: (id) => id === 'terminal-one' || id === 'terminal-two',
    },
  });

  return {
    assignedWorkspaces,
    discover: ipcMain.handlers.get(GIT_CHANNELS.discover),
    dispose,
    executionRequests,
    ipcMain,
    logs,
    planRequests,
    preview,
    repository,
    startedIds,
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
      details: { terminalId: 'terminal-one' },
      event: 'git.discovery_requested',
      level: 'info',
    },
    {
      details: { terminalId: 'terminal-one' },
      event: 'git.discovery_succeeded',
      level: 'info',
    },
  ]);

  harness.dispose();
  assert.equal(harness.ipcMain.handlers.size, 0);
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
  assert.equal(mutationResult.error.rollbackState, 'rolled-back');
  assert.deepEqual(failedMutation.startedIds, []);
  assert.equal(startResult.ok, true);
  assert.equal(startResult.session, null);
  assert.equal(startResult.terminalError.code, 'TERMINAL_START_FAILED');
  assert.deepEqual(failedStart.assignedWorkspaces, [
    { id: 'terminal-one', workspace: failedStart.workspace },
  ]);

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
  assert.equal(secondSuccess.id, 'terminal-two');
  assert.equal(secondSuccess.ok, false);
  assert.equal(secondSuccess.error.code, GIT_ERROR_CODES.missing);

  unavailable.dispose();
  missingGit.dispose();
});
