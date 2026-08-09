const assert = require('node:assert/strict');
const test = require('node:test');

const { TerminalManager } = require('../src/terminal/terminal-manager');
const { WorkspaceService } = require('../src/workspace/workspace-service');
const { validateWorkspaceState } = require('../src/workspace/workspace-state');

const FIRST_ID = 'terminal-11111111-1111-4111-8111-111111111111';
const SECOND_ID = 'terminal-22222222-2222-4222-8222-222222222222';
const THIRD_ID = 'terminal-33333333-3333-4333-8333-333333333333';
const cloneValue = (value) => JSON.parse(JSON.stringify(value));

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
