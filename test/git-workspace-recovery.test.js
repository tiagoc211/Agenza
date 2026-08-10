const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  GIT_RECOVERY_CODES,
  inspectSavedGitWorkspace,
} = require('../src/git/git-workspace-recovery');

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const createFixture = () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-recovery-'));
  const repositoryRoot = path.join(temporaryDirectory, 'repository');
  const worktreePath = path.join(temporaryDirectory, 'agent-worktree');

  fs.mkdirSync(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryRoot, ['config', 'user.name', 'Agenza Tests']);
  git(repositoryRoot, ['config', 'user.email', 'tests@agenza.local']);
  fs.writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'preserved\n', 'utf8');
  git(repositoryRoot, ['add', 'fixture.txt']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'fixture']);
  git(repositoryRoot, ['branch', 'agent-work']);
  git(repositoryRoot, ['worktree', 'add', '--quiet', worktreePath, 'agent-work']);

  return {
    repositoryRoot: path.resolve(repositoryRoot),
    temporaryDirectory,
    workspace: {
      kind: 'git-worktree',
      projectPath: path.resolve(worktreePath),
      repository: {
        branch: 'refs/heads/agent-work',
        root: path.resolve(repositoryRoot),
        worktree: {
          ownership: { creationId: null, kind: 'external' },
          path: path.resolve(worktreePath),
        },
      },
    },
    worktreePath: path.resolve(worktreePath),
  };
};

test('recognizes an unchanged saved Git worktree as available', async () => {
  const fixture = createFixture();

  try {
    const status = await inspectSavedGitWorkspace(fixture.workspace);

    assert.equal(status.status, 'available');
    assert.equal(status.path, fixture.worktreePath);
    assert.equal(status.recoveryPath, fixture.repositoryRoot);
  } finally {
    fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
  }
});

test('detects a worktree moved externally and reports its registered candidate path', async () => {
  const fixture = createFixture();
  const movedPath = path.join(fixture.temporaryDirectory, 'agent-worktree-moved');

  try {
    git(fixture.repositoryRoot, ['worktree', 'move', fixture.worktreePath, movedPath]);
    const status = await inspectSavedGitWorkspace(fixture.workspace);

    assert.equal(status.status, 'stale');
    assert.equal(status.code, GIT_RECOVERY_CODES.worktreeMoved);
    assert.equal(status.candidatePath, path.resolve(movedPath));
    assert.equal(status.recoveryPath, fixture.repositoryRoot);
  } finally {
    fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
  }
});

test('detects externally removed worktrees without pruning their Git metadata', async () => {
  const fixture = createFixture();

  try {
    git(fixture.repositoryRoot, ['worktree', 'remove', fixture.worktreePath]);
    const before = git(fixture.repositoryRoot, ['worktree', 'list', '--porcelain']);
    const status = await inspectSavedGitWorkspace(fixture.workspace);
    const after = git(fixture.repositoryRoot, ['worktree', 'list', '--porcelain']);

    assert.equal(status.code, GIT_RECOVERY_CODES.worktreeMissing);
    assert.equal(status.status, 'stale');
    assert.equal(after, before);
    assert.match(git(fixture.repositoryRoot, ['branch', '--list', 'agent-work']), /agent-work/);
  } finally {
    fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
  }
});

test('detects externally renamed branches while preserving the current worktree', async () => {
  const fixture = createFixture();

  try {
    git(fixture.worktreePath, ['branch', '--move', 'agent-renamed']);
    const status = await inspectSavedGitWorkspace(fixture.workspace);

    assert.equal(status.code, GIT_RECOVERY_CODES.branchMissing);
    assert.equal(status.status, 'stale');
    assert.equal(fs.existsSync(fixture.worktreePath), true);
    assert.equal(git(fixture.worktreePath, ['branch', '--show-current']).trim(), 'agent-renamed');
  } finally {
    fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
  }
});

test('detects an externally deleted repository without mutating the remaining directory', async () => {
  const fixture = createFixture();

  try {
    fs.rmSync(fixture.repositoryRoot, { force: true, recursive: true });
    const status = await inspectSavedGitWorkspace(fixture.workspace);

    assert.equal(status.code, GIT_RECOVERY_CODES.repositoryMissing);
    assert.equal(status.status, 'stale');
    assert.equal(fs.existsSync(fixture.worktreePath), true);
  } finally {
    fs.rmSync(fixture.temporaryDirectory, { force: true, recursive: true });
  }
});
