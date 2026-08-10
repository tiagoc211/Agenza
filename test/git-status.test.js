const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { GIT_ERROR_CODES } = require('../src/git/git-command');
const { parseStatusRecords, readGitWorkspaceStatus } = require('../src/git/git-status');

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const createRepository = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-git-status-'));
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  git(directory, ['config', 'user.name', 'Agenza Tests']);
  git(directory, ['config', 'user.email', 'tests@agenza.local']);
  fs.writeFileSync(path.join(directory, 'fixture.txt'), 'initial\n', 'utf8');
  git(directory, ['add', 'fixture.txt']);
  git(directory, ['commit', '--quiet', '-m', 'initial']);
  return directory;
};

test('parses porcelain v2 records into counts without returning file names', () => {
  const status = parseStatusRecords(
    '1 .M N... 100644 100644 100644 abc abc tracked.txt\0' +
      '2 R. N... 100644 100644 100644 abc def R100 renamed.txt\0original.txt\0' +
      'u UU N... 100644 100644 100644 100644 abc def 000 conflict.txt\0' +
      '? untracked.txt\0',
  );

  assert.deepEqual(status, {
    conflicted: 1,
    isClean: false,
    tracked: 2,
    untracked: 1,
  });
  assert.equal(JSON.stringify(status).includes('tracked.txt'), false);
});

test('reads clean, tracked, and untracked status from a real repository', async () => {
  const repositoryPath = createRepository();

  try {
    const clean = await readGitWorkspaceStatus(repositoryPath);

    assert.equal(clean.branch, 'main');
    assert.equal(clean.repositoryRoot, path.resolve(repositoryPath));
    assert.equal(clean.worktreePath, path.resolve(repositoryPath));
    assert.deepEqual(clean.changes, {
      conflicted: 0,
      isClean: true,
      tracked: 0,
      untracked: 0,
    });

    fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'modified\n', 'utf8');
    fs.writeFileSync(path.join(repositoryPath, 'untracked.txt'), 'new\n', 'utf8');
    const dirty = await readGitWorkspaceStatus(repositoryPath);

    assert.deepEqual(dirty.changes, {
      conflicted: 0,
      isClean: false,
      tracked: 1,
      untracked: 1,
    });
  } finally {
    fs.rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test('reports conflicted files from a real unresolved merge', async () => {
  const repositoryPath = createRepository();

  try {
    git(repositoryPath, ['switch', '--quiet', '-c', 'other']);
    fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'other\n', 'utf8');
    git(repositoryPath, ['commit', '--quiet', '-am', 'other']);
    git(repositoryPath, ['switch', '--quiet', 'main']);
    fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'main\n', 'utf8');
    git(repositoryPath, ['commit', '--quiet', '-am', 'main']);
    const merge = spawnSync('git', ['merge', 'other'], {
      cwd: repositoryPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.notEqual(merge.status, 0);
    const status = await readGitWorkspaceStatus(repositoryPath);
    assert.equal(status.changes.conflicted, 1);
    assert.equal(status.changes.isClean, false);
  } finally {
    fs.rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test('rejects malformed status output as a bounded Git response error', () => {
  assert.throws(
    () => parseStatusRecords('unexpected record\0'),
    (error) => error.code === GIT_ERROR_CODES.unexpectedOutput,
  );
});
