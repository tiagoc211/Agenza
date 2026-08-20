const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  discoverGitRepository,
  parseBranchRecords,
  parseWorktreeRecords,
} = require('../src/git/git-discovery');

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('parses local branches and registered worktree lifecycle state', () => {
  const worktrees = parseWorktreeRecords(
    [
      'worktree C:\\repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree C:\\repo-feature',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feature',
      'locked in use',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\0'),
  );
  const branches = parseBranchRecords(
    [
      'refs/heads/feature',
      'feature',
      '2222222222222222222222222222222222222222',
      'C:\\repo-feature',
      '\nrefs/heads/main',
      'main',
      '1111111111111111111111111111111111111111',
      'C:\\repo',
      '\n',
    ].join('\0'),
  );

  assert.deepEqual(
    worktrees.map(({ branch, locked, lockReason, path: worktreePath, prunable }) => ({
      branch,
      locked,
      lockReason,
      path: worktreePath,
      prunable,
    })),
    [
      {
        branch: 'main',
        locked: false,
        lockReason: null,
        path: path.resolve('C:\\repo'),
        prunable: false,
      },
      {
        branch: 'feature',
        locked: true,
        lockReason: 'in use',
        path: path.resolve('C:\\repo-feature'),
        prunable: true,
      },
    ],
  );
  assert.deepEqual(
    branches.map(({ name, worktreePath }) => ({ name, worktreePath })),
    [
      { name: 'feature', worktreePath: path.resolve('C:\\repo-feature') },
      { name: 'main', worktreePath: path.resolve('C:\\repo') },
    ],
  );
});

test('discovers repository root, current branch, local branches, and worktrees without mutation', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-git-discovery-'));
  const repositoryPath = path.join(temporaryDirectory, 'repository');
  const featureWorktreePath = path.join(temporaryDirectory, 'feature-worktree');

  try {
    fs.mkdirSync(repositoryPath);
    git(repositoryPath, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryPath, ['config', 'user.name', 'Agenza Tests']);
    git(repositoryPath, ['config', 'user.email', 'tests@agenza.local']);
    fs.writeFileSync(path.join(repositoryPath, 'README.md'), '# fixture\n', 'utf8');
    git(repositoryPath, ['add', 'README.md']);
    git(repositoryPath, ['commit', '--quiet', '-m', 'fixture']);
    git(repositoryPath, ['branch', 'feature']);
    git(repositoryPath, ['worktree', 'add', '--quiet', featureWorktreePath, 'feature']);

    const beforeStatus = git(repositoryPath, ['status', '--porcelain=v1']);
    const beforeWorktrees = git(repositoryPath, ['worktree', 'list', '--porcelain']);
    const discovery = await discoverGitRepository(featureWorktreePath);
    const afterStatus = git(repositoryPath, ['status', '--porcelain=v1']);
    const afterWorktrees = git(repositoryPath, ['worktree', 'list', '--porcelain']);

    assert.equal(discovery.root, path.resolve(repositoryPath));
    assert.equal(discovery.worktreePath, path.resolve(featureWorktreePath));
    assert.equal(discovery.currentBranch, 'feature');
    assert.equal(discovery.currentBranchRef, 'refs/heads/feature');
    assert.equal(discovery.detached, false);
    assert.deepEqual(
      discovery.branches.map(({ name }) => name),
      ['feature', 'main'],
    );
    assert.equal(discovery.worktrees.length, 2);
    assert.equal(discovery.worktrees.filter(({ isCurrent }) => isCurrent).length, 1);
    assert.equal(beforeStatus, afterStatus);
    assert.equal(beforeWorktrees, afterWorktrees);
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
