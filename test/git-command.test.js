const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_GIT_MAX_BUFFER,
  DEFAULT_GIT_TIMEOUT_MS,
  GIT_ERROR_CODES,
  runGit,
} = require('../src/git/git-command');

test('runs Git directly with bounded process options and no shell', async () => {
  let invocation = null;
  const result = await runGit(['status', '--porcelain'], {
    cwd: 'C:\\repo',
    execFileImpl: (file, args, options, callback) => {
      invocation = { args, file, options };
      callback(null, 'clean', '');
    },
  });

  assert.deepEqual(result, { exitCode: 0, stderr: '', stdout: 'clean' });
  assert.equal(invocation.file, 'git');
  assert.deepEqual(invocation.args, ['status', '--porcelain']);
  assert.deepEqual(invocation.options, {
    cwd: 'C:\\repo',
    encoding: 'utf8',
    maxBuffer: DEFAULT_GIT_MAX_BUFFER,
    timeout: DEFAULT_GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  assert.equal('shell' in invocation.options, false);
});

test('accepts explicitly expected Git exit codes', async () => {
  const result = await runGit(['symbolic-ref', '--quiet', 'HEAD'], {
    allowedExitCodes: [0, 1],
    cwd: 'C:\\repo',
    execFileImpl: (_file, _args, _options, callback) =>
      callback(Object.assign(new Error('detached'), { code: 1 }), '', ''),
  });

  assert.deepEqual(result, { exitCode: 1, stderr: '', stdout: '' });
});

test('maps missing Git, non-repositories, timeouts, and output limits to concise errors', async () => {
  const cases = [
    {
      code: GIT_ERROR_CODES.missing,
      error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }),
      stderr: '',
    },
    {
      code: GIT_ERROR_CODES.notRepository,
      error: Object.assign(new Error('failed'), { code: 128 }),
      stderr: 'fatal: not a git repository',
    },
    {
      code: GIT_ERROR_CODES.timeout,
      error: Object.assign(new Error('stopped'), { killed: true }),
      stderr: '',
    },
    {
      code: GIT_ERROR_CODES.outputLimit,
      error: Object.assign(new Error('stdout maxBuffer length exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }),
      stderr: '',
    },
  ];

  for (const expected of cases) {
    await assert.rejects(
      runGit(['status'], {
        cwd: 'C:\\repo',
        execFileImpl: (_file, _args, _options, callback) =>
          callback(expected.error, '', expected.stderr),
      }),
      (error) => error.code === expected.code && !error.message.includes('fatal:'),
    );
  }
});

test('rejects unbounded or malformed Git command requests before spawning', () => {
  assert.throws(
    () => runGit([], { cwd: 'C:\\repo' }),
    (error) => error.code === GIT_ERROR_CODES.invalidRequest,
  );
  assert.throws(
    () => runGit(['status'], { cwd: 'C:\\repo', timeoutMs: 0 }),
    (error) => error.code === GIT_ERROR_CODES.invalidRequest,
  );
});
