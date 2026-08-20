const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fingerprintIdentifier,
  sanitizeGitLifecycleDetails,
  writeGitLifecycleLog,
} = require('../src/git/git-lifecycle-log');

test('Git lifecycle logs keep only allowlisted non-sensitive metadata', () => {
  const details = sanitizeGitLifecycleDetails({
    args: ['push', 'https://person:remote-secret@example.test/repo.git'],
    command: 'git push',
    creationId: 'worktree-secret-id',
    env: { PRIVATE_TOKEN: 'environment-secret' },
    error: new Error('stderr-secret'),
    errorCode: 'GIT_TIMEOUT',
    operationId: 'operation-secret-id',
    operationType: 'create_new',
    ownershipKind: 'agenza',
    repositoryRoot: 'C:\\private\\repository',
    rollbackState: 'rolled-back',
    terminalId: 'terminal-secret-id',
    workspaceState: 'failed',
  });

  assert.deepEqual(details, {
    errorCode: 'GIT_TIMEOUT',
    operation: fingerprintIdentifier('operation', 'operation-secret-id'),
    operationType: 'create_new',
    ownershipKind: 'agenza',
    rollbackState: 'rolled-back',
    terminal: fingerprintIdentifier('terminal', 'terminal-secret-id'),
    workspaceState: 'failed',
    worktree: fingerprintIdentifier('worktree', 'worktree-secret-id'),
  });

  const serialized = JSON.stringify(details);
  for (const sensitiveValue of [
    'remote-secret',
    'environment-secret',
    'stderr-secret',
    'private',
    'operation-secret-id',
    'terminal-secret-id',
    'worktree-secret-id',
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('Git lifecycle log writer rejects invalid events and contains logger failures', () => {
  const captured = [];
  const logger = {
    warn: (event, details) => captured.push({ details, event }),
  };

  assert.deepEqual(
    writeGitLifecycleLog(logger, 'warn', 'git.status_failed', {
      errorCode: 'GIT_TIMEOUT',
      terminalId: 'terminal-one',
      workspaceState: 'failed',
    }),
    1,
  );
  assert.equal(writeGitLifecycleLog(logger, 'debug', 'git.status_failed', {}), false);
  assert.equal(writeGitLifecycleLog(logger, 'warn', 'terminal.status_failed', {}), false);
  assert.equal(
    writeGitLifecycleLog(
      {
        error: () => {
          throw new Error('logger unavailable');
        },
      },
      'error',
      'git.status_failed',
      {},
    ),
    false,
  );
  assert.equal(captured.length, 1);
});
