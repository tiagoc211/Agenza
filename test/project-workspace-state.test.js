const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PROJECT_WORKSPACE_BACKUP_FILENAME,
  PROJECT_WORKSPACE_STATE_FILENAME,
  ProjectWorkspaceStateStore,
} = require('../src/project-workspaces/project-workspace-state');

const createTemporaryDirectory = async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agenza-project-workspace-test-'));
  context.after(() => fs.rm(directory, { force: true, recursive: true }));
  return directory;
};

test('persists the project workspace catalog atomically and retains its backup', async (context) => {
  const directory = await createTemporaryDirectory(context);
  const store = new ProjectWorkspaceStateStore({ directory });
  const { state } = await store.load();
  const next = {
    ...state,
    revision: 1,
    activeWorkspaceId: 'workspace-00000000-0000-4000-8000-000000000001',
    workspaces: [
      {
        id: 'workspace-00000000-0000-4000-8000-000000000001',
        name: 'Agenza',
        projectPath: 'C:\\Projects\\Agenza',
        terminalIds: ['terminal-one'],
        createdAt: '2026-08-21T12:00:00.000Z',
        updatedAt: '2026-08-21T12:00:00.000Z',
      },
    ],
  };

  await store.save(next);

  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(directory, PROJECT_WORKSPACE_STATE_FILENAME), 'utf8')),
    next,
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(directory, PROJECT_WORKSPACE_BACKUP_FILENAME), 'utf8')),
    state,
  );
});

test('preserves an invalid project workspace catalog instead of overwriting it', async (context) => {
  const directory = await createTemporaryDirectory(context);
  const filePath = path.join(directory, PROJECT_WORKSPACE_STATE_FILENAME);
  const invalidSource = '{"schemaVersion":99,"private":"preserve me"}\n';
  await fs.writeFile(filePath, invalidSource, 'utf8');

  const store = new ProjectWorkspaceStateStore({ directory });
  const loaded = await store.load();

  assert.match(loaded.issue, /invalid and was preserved/);
  await assert.rejects(store.save(loaded.state), /Repair or move/);
  assert.equal(await fs.readFile(filePath, 'utf8'), invalidSource);
});
