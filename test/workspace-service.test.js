const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { TerminalManager } = require('../src/terminal/terminal-manager');
const { WorkspaceService } = require('../src/workspace/workspace-service');
const { validateWorkspaceState } = require('../src/workspace/workspace-state');

const FIRST_ID = 'terminal-11111111-1111-4111-8111-111111111111';
const SECOND_ID = 'terminal-22222222-2222-4222-8222-222222222222';
const THIRD_ID = 'terminal-33333333-3333-4333-8333-333333333333';
const cloneValue = (value) => JSON.parse(JSON.stringify(value));
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

class FakeSession {
  constructor(id) {
    this.id = id;
    this.dataListeners = new Set();
    this.exitListeners = new Set();
    this.disposed = false;
  }

  onData(listener) {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  snapshot() {
    return { id: this.id, isRunning: false, pid: null, columns: 80, rows: 24 };
  }

  dispose() {
    this.disposed = true;
  }
}

const createState = () => ({
  schemaVersion: 1,
  revision: 4,
  activeTerminalId: SECOND_ID,
  terminals: [
    {
      id: FIRST_ID,
      label: 'Terminal 1',
      order: 0,
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:01:00.000Z',
      workspace: {
        kind: 'folder',
        projectPath: 'C:\\Projects\\Available',
        repository: null,
      },
    },
    {
      id: SECOND_ID,
      label: 'Terminal 2',
      order: 1,
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:02:00.000Z',
      workspace: {
        kind: 'folder',
        projectPath: 'C:\\Projects\\Missing',
        repository: null,
      },
    },
  ],
});

const createHarness = (initialState = createState()) => {
  const savedStates = [];
  const sessions = new Map();
  const stateStore = {
    load: async () => ({
      canPersist: true,
      issue: null,
      source: 'saved',
      state: cloneValue(initialState),
    }),
    save: async (state) => {
      validateWorkspaceState(state);
      savedStates.push(cloneValue(state));
    },
  };
  const terminalManager = new TerminalManager({
    sessionFactory: (id) => {
      const session = new FakeSession(id);
      sessions.set(id, session);
      return session;
    },
    sessionIdFactory: () => THIRD_ID,
  });
  let minute = 3;
  const service = new WorkspaceService({
    now: () => `2026-08-09T12:0${minute++}:00.000Z`,
    stateStore,
    terminalManager,
    validateFolder: async (folder) => {
      if (folder.endsWith('Missing')) {
        throw new Error('missing');
      }

      return folder;
    },
  });

  return { savedStates, service, sessions, terminalManager };
};

test('restores labels, order, active terminal, and available folders independently', async () => {
  const { service, terminalManager } = createHarness();
  const catalog = await service.initialize();

  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.revision, 4);
  assert.equal(catalog.activeTerminalId, SECOND_ID);
  assert.deepEqual(
    catalog.sessions.map(({ id, label, order, isActive, workspaceStatus }) => ({
      id,
      label,
      order,
      isActive,
      workspaceStatus,
    })),
    [
      {
        id: FIRST_ID,
        label: 'Terminal 1',
        order: 0,
        isActive: false,
        workspaceStatus: { path: 'C:\\Projects\\Available', status: 'available' },
      },
      {
        id: SECOND_ID,
        label: 'Terminal 2',
        order: 1,
        isActive: true,
        workspaceStatus: { path: 'C:\\Projects\\Missing', status: 'missing' },
      },
    ],
  );
  assert.deepEqual(service.getInitialFolders(), {
    [FIRST_ID]: 'C:\\Projects\\Available',
  });
  assert.equal(service.getCurrentFolder(FIRST_ID), 'C:\\Projects\\Available');
  assert.equal(service.getCurrentFolder(SECOND_ID), null);

  terminalManager.dispose();
});

test('persists create, active pane, folder assignment, removal, and contiguous order', async () => {
  const { savedStates, service, sessions, terminalManager } = createHarness();

  await service.initialize();
  const created = await service.create();
  await service.activate(FIRST_ID);
  await service.assignFolder(SECOND_ID, 'C:\\Projects\\Recovered');
  await service.remove(FIRST_ID);
  const catalog = service.getCatalog();
  const finalState = savedStates.at(-1);

  assert.equal(created.id, THIRD_ID);
  assert.equal(created.label, 'Terminal 3');
  assert.equal(catalog.activeTerminalId, SECOND_ID);
  assert.deepEqual(
    catalog.sessions.map(({ id, label, order }) => ({ id, label, order })),
    [
      { id: SECOND_ID, label: 'Terminal 2', order: 0 },
      { id: THIRD_ID, label: 'Terminal 3', order: 1 },
    ],
  );
  assert.deepEqual(finalState.terminals[0].workspace, {
    kind: 'folder',
    projectPath: 'C:\\Projects\\Recovered',
    repository: null,
  });
  assert.equal(finalState.revision, 8);
  assert.equal(sessions.get(FIRST_ID).disposed, true);
  assert.equal('pid' in finalState.terminals[0], false);

  terminalManager.dispose();
});

test('removes only the terminal definition and process while preserving its real Git worktree', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-remove-terminal-'));
  const repositoryPath = path.join(temporaryDirectory, 'repository');
  const worktreePath = path.join(temporaryDirectory, 'agent-worktree');

  fs.mkdirSync(repositoryPath);
  git(repositoryPath, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryPath, ['config', 'user.name', 'Agenza Tests']);
  git(repositoryPath, ['config', 'user.email', 'tests@agenza.local']);
  fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'preserved\n', 'utf8');
  git(repositoryPath, ['add', 'fixture.txt']);
  git(repositoryPath, ['commit', '--quiet', '-m', 'initial']);
  git(repositoryPath, ['branch', 'agent-work']);
  git(repositoryPath, ['worktree', 'add', '--quiet', worktreePath, 'agent-work']);
  fs.writeFileSync(path.join(worktreePath, 'agent-output.txt'), 'untracked work\n', 'utf8');

  const state = createState();
  state.terminals[0].workspace = {
    kind: 'git-worktree',
    projectPath: worktreePath,
    repository: {
      branch: 'refs/heads/agent-work',
      root: repositoryPath,
      worktree: {
        ownership: {
          creationId: 'worktree-33333333-3333-4333-8333-333333333333',
          kind: 'agenza',
        },
        path: worktreePath,
      },
    },
  };
  const { savedStates, service, sessions, terminalManager } = createHarness(state);

  try {
    await service.initialize();
    const secondBefore = service.getCatalog().sessions.find(({ id }) => id === SECOND_ID);
    await service.remove(FIRST_ID);
    const secondAfter = service.getCatalog().sessions.find(({ id }) => id === SECOND_ID);

    assert.equal(sessions.get(FIRST_ID).disposed, true);
    assert.equal(service.has(FIRST_ID), false);
    assert.deepEqual(secondAfter, { ...secondBefore, order: 0 });
    assert.deepEqual(
      savedStates.at(-1).terminals.map(({ id }) => id),
      [SECOND_ID],
    );
    assert.deepEqual(service.getManagedWorktrees(), [
      {
        assignedTerminalId: null,
        branchRef: 'refs/heads/agent-work',
        creationId: 'worktree-33333333-3333-4333-8333-333333333333',
        path: worktreePath,
        repositoryRoot: repositoryPath,
      },
    ]);
    assert.equal(fs.existsSync(worktreePath), true);
    assert.equal(
      fs.readFileSync(path.join(worktreePath, 'agent-output.txt'), 'utf8'),
      'untracked work\n',
    );
    assert.match(git(repositoryPath, ['branch', '--list', 'agent-work']), /agent-work/);
    assert.match(git(repositoryPath, ['worktree', 'list', '--porcelain']), /agent-worktree/);
  } finally {
    terminalManager.dispose();
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('restores the saved terminal definition if its process tree cannot be removed', async () => {
  const state = createState();
  state.terminals[0].workspace = {
    kind: 'git-worktree',
    projectPath: 'C:\\Projects\\Available',
    repository: {
      branch: 'refs/heads/agent-one',
      root: 'C:\\Projects\\Repository',
      worktree: {
        ownership: { creationId: null, kind: 'external' },
        path: 'C:\\Projects\\Available',
      },
    },
  };
  const { savedStates, service, sessions, terminalManager } = createHarness(state);

  await service.initialize();
  const firstSession = sessions.get(FIRST_ID);
  const disposeSession = firstSession.dispose.bind(firstSession);
  firstSession.dispose = () => {
    throw new Error('simulated process-tree cleanup failure');
  };

  try {
    await assert.rejects(service.remove(FIRST_ID), /process-tree cleanup failure/);
    const restored = service.getCatalog().sessions.find(({ id }) => id === FIRST_ID);

    assert.deepEqual(restored.workspace, state.terminals[0].workspace);
    assert.equal(service.has(FIRST_ID), true);
    assert.deepEqual(
      savedStates.at(-1).terminals.map(({ id }) => id),
      [FIRST_ID, SECOND_ID],
    );
  } finally {
    firstSession.dispose = disposeSession;
    terminalManager.dispose();
  }
});

test('restores a deliberately empty saved layout without creating fallback sessions', async () => {
  const emptyState = {
    schemaVersion: 1,
    revision: 9,
    activeTerminalId: null,
    terminals: [],
  };
  const { service, terminalManager } = createHarness(emptyState);
  const catalog = await service.initialize();

  assert.deepEqual(catalog.sessions, []);
  assert.equal(catalog.activeTerminalId, null);
  terminalManager.dispose();
});

test('lists persisted Git worktree assignments without exposing the selected terminal itself', async () => {
  const state = createState();
  state.terminals[0].workspace = {
    kind: 'git-worktree',
    projectPath: 'C:\\Projects\\Available',
    repository: {
      branch: 'refs/heads/agent-one',
      root: 'C:\\Projects\\Repository',
      worktree: {
        ownership: { creationId: null, kind: 'external' },
        path: 'C:\\Projects\\Available',
      },
    },
  };
  const { service, terminalManager } = createHarness(state);

  await service.initialize();

  assert.deepEqual(service.getAssignedGitWorktrees(), [
    { path: 'C:\\Projects\\Available', terminalId: FIRST_ID },
  ]);
  assert.deepEqual(service.getAssignedGitWorktrees(FIRST_ID), []);

  terminalManager.dispose();
});

test('persists an Agenza-owned Git worktree only for the selected terminal', async () => {
  const { savedStates, service, terminalManager } = createHarness();
  const workspace = {
    kind: 'git-worktree',
    projectPath: 'C:\\Projects\\AgentOne',
    repository: {
      branch: 'refs/heads/agent-one',
      root: 'C:\\Projects\\Repository',
      worktree: {
        ownership: {
          creationId: 'worktree-33333333-3333-4333-8333-333333333333',
          kind: 'agenza',
        },
        path: 'C:\\Projects\\AgentOne',
      },
    },
  };

  await service.initialize();
  const secondBefore = service.getCatalog().sessions.find(({ id }) => id === SECOND_ID);
  const assigned = await service.assignGitWorktree(FIRST_ID, workspace);
  const secondAfter = service.getCatalog().sessions.find(({ id }) => id === SECOND_ID);

  assert.deepEqual(assigned.workspace, workspace);
  assert.deepEqual(assigned.workspaceStatus, {
    path: 'C:\\Projects\\AgentOne',
    status: 'available',
  });
  assert.deepEqual(savedStates.at(-1).terminals[0].workspace, workspace);
  assert.deepEqual(savedStates.at(-1).managedWorktrees, [
    {
      branchRef: workspace.repository.branch,
      creationId: workspace.repository.worktree.ownership.creationId,
      path: workspace.projectPath,
      repositoryRoot: workspace.repository.root,
    },
  ]);
  assert.equal(service.getManagedWorktrees()[0].assignedTerminalId, FIRST_ID);
  await assert.rejects(
    service.forgetManagedWorktree(workspace.repository.worktree.ownership.creationId),
    /assigned worktree/,
  );
  await service.assignFolder(FIRST_ID, 'C:\\Projects\\Replacement');
  assert.equal(service.getManagedWorktrees()[0].assignedTerminalId, null);
  await service.forgetManagedWorktree(workspace.repository.worktree.ownership.creationId);
  assert.deepEqual(service.getManagedWorktrees(), []);
  assert.deepEqual(secondAfter, secondBefore);

  terminalManager.dispose();
});
