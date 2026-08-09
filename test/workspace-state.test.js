const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  WORKSPACE_BACKUP_FILENAME,
  WORKSPACE_STATE_FILENAME,
  WorkspaceStateStore,
  createDefaultWorkspaceState,
  validateWorkspaceState,
} = require('../src/workspace/workspace-state');

const TERMINAL_IDS = [
  'terminal-11111111-1111-4111-8111-111111111111',
  'terminal-22222222-2222-4222-8222-222222222222',
];
const NOW = '2026-08-09T12:00:00.000Z';
const cloneValue = (value) => JSON.parse(JSON.stringify(value));

const createTemporaryDirectory = async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agenza-state-test-'));
  context.after(() => fs.rm(directory, { force: true, recursive: true }));
  return directory;
};

const createDeterministicStore = (directory) => {
  let idIndex = 0;
  return new WorkspaceStateStore({
    directory,
    idFactory: () => TERMINAL_IDS[idIndex++],
    now: () => NOW,
  });
};

test('creates and persists a useful versioned default layout on first launch', async (context) => {
  const directory = await createTemporaryDirectory(context);
  const store = createDeterministicStore(directory);
  const loaded = await store.load();
  const persisted = JSON.parse(
    await fs.readFile(path.join(directory, WORKSPACE_STATE_FILENAME), 'utf8'),
  );

  assert.equal(loaded.source, 'default');
  assert.equal(loaded.canPersist, true);
  assert.equal(loaded.state.schemaVersion, 1);
  assert.equal(loaded.state.revision, 0);
  assert.equal(loaded.state.activeTerminalId, TERMINAL_IDS[0]);
  assert.deepEqual(
    loaded.state.terminals.map(({ id, label, order, workspace }) => ({
      id,
      label,
      order,
      workspace,
    })),
    [
      {
        id: TERMINAL_IDS[0],
        label: 'Terminal 1',
        order: 0,
        workspace: { kind: 'unassigned', projectPath: null, repository: null },
      },
      {
        id: TERMINAL_IDS[1],
        label: 'Terminal 2',
        order: 1,
        workspace: { kind: 'unassigned', projectPath: null, repository: null },
      },
    ],
  );
  assert.deepEqual(persisted, loaded.state);
});

test('atomically replaces valid state and retains the previous valid backup', async (context) => {
  const directory = await createTemporaryDirectory(context);
  const store = createDeterministicStore(directory);
  const { state: initialState } = await store.load();
  const nextState = cloneValue(initialState);

  nextState.revision = 1;
  nextState.terminals[0].updatedAt = '2026-08-09T12:01:00.000Z';
  nextState.terminals[0].workspace = {
    kind: 'folder',
    projectPath: 'C:\\Projects\\Agenza',
    repository: null,
  };
  await store.save(nextState);

  const persisted = JSON.parse(
    await fs.readFile(path.join(directory, WORKSPACE_STATE_FILENAME), 'utf8'),
  );
  const backup = JSON.parse(
    await fs.readFile(path.join(directory, WORKSPACE_BACKUP_FILENAME), 'utf8'),
  );

  assert.deepEqual(persisted, nextState);
  assert.deepEqual(backup, initialState);
  assert.deepEqual((await createDeterministicStore(directory).load()).state, nextState);
});

test('preserves invalid or newer source state and refuses to overwrite it', async (context) => {
  const directory = await createTemporaryDirectory(context);
  const filePath = path.join(directory, WORKSPACE_STATE_FILENAME);
  const invalidSource = '{"schemaVersion":99,"private":"preserve me"}\n';

  await fs.writeFile(filePath, invalidSource, 'utf8');
  const store = createDeterministicStore(directory);
  const loaded = await store.load();

  assert.equal(loaded.source, 'recovery');
  assert.equal(loaded.canPersist, false);
  assert.match(loaded.issue, /original file was preserved/);
  await assert.rejects(store.save(loaded.state), /must be repaired or moved/);
  assert.equal(await fs.readFile(filePath, 'utf8'), invalidSource);
});

test('rejects non-schema fields, unsafe ids, non-contiguous order, and duplicate worktrees', () => {
  const state = createDefaultWorkspaceState({
    idFactory: (() => {
      let idIndex = 0;
      return () => TERMINAL_IDS[idIndex++];
    })(),
    now: () => NOW,
  });

  assert.throws(
    () => validateWorkspaceState({ ...state, terminalOutput: 'secret' }),
    /invalid or missing fields/,
  );

  const unsafeIdState = cloneValue(state);
  unsafeIdState.terminals[0].id = 'terminal-one';
  unsafeIdState.activeTerminalId = 'terminal-one';
  assert.throws(() => validateWorkspaceState(unsafeIdState), /id is invalid/);

  const invalidOrderState = cloneValue(state);
  invalidOrderState.terminals[1].order = 3;
  assert.throws(() => validateWorkspaceState(invalidOrderState), /contiguous/);

  const duplicateWorktreeState = cloneValue(state);
  duplicateWorktreeState.terminals = duplicateWorktreeState.terminals.map((terminal) => ({
    ...terminal,
    workspace: {
      kind: 'git-worktree',
      projectPath: 'C:\\Projects\\Agenza-worktree',
      repository: {
        root: 'C:\\Projects\\Agenza',
        branch: `refs/heads/${terminal.label}`,
        worktree: {
          path: 'C:\\Projects\\Agenza-worktree',
          ownership: { kind: 'external', creationId: null },
        },
      },
    },
  }));
  assert.throws(() => validateWorkspaceState(duplicateWorktreeState), /multiple terminals/);
});
