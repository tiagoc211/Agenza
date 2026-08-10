const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readGitWorkspaceStatus } = require('../src/git/git-status');
const { GIT_CLEANUP_ERROR_CODES, GitWorktreeCleanup } = require('../src/git/git-worktree-cleanup');

const CREATION_ID = 'worktree-22222222-2222-4222-8222-222222222222';
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const createOwnedWorktree = () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-cleanup-'));
  const repositoryRoot = path.join(temporaryDirectory, 'repository');
  const worktreePath = path.join(temporaryDirectory, 'agent-worktree');

  fs.mkdirSync(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryRoot, ['config', 'user.name', 'Agenza Tests']);
  git(repositoryRoot, ['config', 'user.email', 'tests@agenza.local']);
  fs.writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'pre-existing\n', 'utf8');
  git(repositoryRoot, ['add', 'fixture.txt']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'fixture']);
  git(repositoryRoot, ['branch', 'agent-work']);
  git(repositoryRoot, ['worktree', 'add', '--quiet', worktreePath, 'agent-work']);

  return {
    record: {
      branchRef: 'refs/heads/agent-work',
      creationId: CREATION_ID,
      path: path.resolve(worktreePath),
      repositoryRoot: path.resolve(repositoryRoot),
    },
    repositoryRoot,
    temporaryDirectory,
    worktreePath,
  };
};

const createCallbacks = (record) => {
  let currentRecord = record;
  return {
    forgetManagedWorktree: async (creationId) => {
      assert.equal(creationId, CREATION_ID);
      currentRecord = null;
    },
    getManagedWorktree: (creationId) => (creationId === CREATION_ID ? currentRecord : null),
    wasForgotten: () => currentRecord === null,
  };
};

test('removes a clean unassigned Agenza worktree without deleting its branch', async () => {
  const fixture = createOwnedWorktree();
  const callbacks = createCallbacks(fixture.record);

  try {
    const cleanup = new GitWorktreeCleanup({
      operationIdFactory: () => 'cleanup-one',
    });
    const preview = await cleanup.preview({
      creationId: CREATION_ID,
      getManagedWorktree: callbacks.getManagedWorktree,
    });
    const result = await cleanup.confirm({
      forgetManagedWorktree: callbacks.forgetManagedWorktree,
      getAssignedWorktrees: () => [],
      getManagedWorktree: callbacks.getManagedWorktree,
      operationId: preview.operationId,
    });

    assert.equal(result.state, 'succeeded');
    assert.equal(result.branchPreserved, true);
    assert.equal(callbacks.wasForgotten(), true);
    assert.equal(fs.existsSync(fixture.worktreePath), false);
    assert.equal(
      git(fixture.repositoryRoot, ['branch', '--list', 'agent-work']).trim(),
      'agent-work',
    );
    assert.equal(
      git(fixture.repositoryRoot, ['worktree', 'list', '--porcelain']).includes('agent-worktree'),
      false,
    );
  } finally {
    fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
  }
});

test('refuses assigned, tracked, untracked, conflicted, locked, and missing worktrees', async (t) => {
  const scenarios = [
    {
      code: GIT_CLEANUP_ERROR_CODES.assigned,
      prepare: () => {},
      options: (fixture) => ({ assignedWorktrees: [{ path: fixture.worktreePath }] }),
    },
    {
      code: GIT_CLEANUP_ERROR_CODES.dirty,
      prepare: (fixture) =>
        fs.writeFileSync(
          path.join(fixture.worktreePath, 'fixture.txt'),
          'tracked change\n',
          'utf8',
        ),
    },
    {
      code: GIT_CLEANUP_ERROR_CODES.untracked,
      prepare: (fixture) =>
        fs.writeFileSync(path.join(fixture.worktreePath, 'untracked.txt'), 'preserve me\n', 'utf8'),
    },
    {
      code: GIT_CLEANUP_ERROR_CODES.conflicted,
      cleanupOptions: {
        readStatus: async (worktreePath) => ({
          ...(await readGitWorkspaceStatus(worktreePath)),
          changes: { conflicted: 1, isClean: false, tracked: 0, untracked: 0 },
        }),
      },
      prepare: () => {},
    },
    {
      code: GIT_CLEANUP_ERROR_CODES.locked,
      prepare: (fixture) => git(fixture.repositoryRoot, ['worktree', 'lock', fixture.worktreePath]),
    },
    {
      code: GIT_CLEANUP_ERROR_CODES.missing,
      prepare: (fixture) => fs.rmSync(fixture.worktreePath, { force: true, recursive: true }),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.code, async () => {
      const fixture = createOwnedWorktree();
      const callbacks = createCallbacks(fixture.record);

      try {
        scenario.prepare(fixture);
        const cleanup = new GitWorktreeCleanup(scenario.cleanupOptions);
        await assert.rejects(
          cleanup.preview({
            creationId: CREATION_ID,
            getManagedWorktree: callbacks.getManagedWorktree,
            ...(scenario.options?.(fixture) ?? {}),
          }),
          (error) => error.code === scenario.code,
        );
        assert.equal(callbacks.wasForgotten(), false);
        assert.match(
          git(fixture.repositoryRoot, ['branch', '--list', 'agent-work']).trim(),
          /agent-work$/,
        );
      } finally {
        fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
      }
    });
  }
});

test('revalidates immediately before cleanup and refuses newly created files', async () => {
  const fixture = createOwnedWorktree();
  const callbacks = createCallbacks(fixture.record);

  try {
    const cleanup = new GitWorktreeCleanup({ operationIdFactory: () => 'cleanup-stale' });
    const preview = await cleanup.preview({
      creationId: CREATION_ID,
      getManagedWorktree: callbacks.getManagedWorktree,
    });
    fs.writeFileSync(path.join(fixture.worktreePath, 'after-preview.txt'), 'preserve me\n', 'utf8');

    await assert.rejects(
      cleanup.confirm({
        forgetManagedWorktree: callbacks.forgetManagedWorktree,
        getAssignedWorktrees: () => [],
        getManagedWorktree: callbacks.getManagedWorktree,
        operationId: preview.operationId,
      }),
      (error) => error.code === GIT_CLEANUP_ERROR_CODES.untracked,
    );
    assert.equal(fs.existsSync(fixture.worktreePath), true);
    assert.equal(callbacks.wasForgotten(), false);
  } finally {
    fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
  }
});
