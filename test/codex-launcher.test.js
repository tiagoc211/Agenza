const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCodexSessionOptions,
  prepareCodexSessionOptions,
  verifyCodexPrerequisites,
} = require('../src/terminal/codex-launcher');

test('creates an interactive Windows Codex command from the system environment', () => {
  const environment = { ComSpec: 'C:\\Windows\\System32\\cmd.exe', PATH: 'system-path' };
  const options = createCodexSessionOptions({
    cwd: 'C:\\project',
    environment,
    platform: 'win32',
  });

  assert.deepEqual(options, {
    shell: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'codex'],
    cwd: 'C:\\project',
    env: environment,
    useConpty: true,
  });
});

test('verifies Codex directly from PATH before terminal startup', async () => {
  let invocation;
  const result = await verifyCodexPrerequisites({
    cwd: 'C:\\project',
    environment: { ComSpec: 'cmd.exe', PATH: 'system-path' },
    platform: 'win32',
    execFileImplementation: (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(null, 'codex-cli 1.2.3\n', '');
    },
  });

  assert.deepEqual(invocation.args, ['/d', '/s', '/c', 'codex --version']);
  assert.equal(invocation.file, 'cmd.exe');
  assert.equal(invocation.options.env.PATH, 'system-path');
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(result.version, 'codex-cli 1.2.3');
});

test('uses the normal shell lookup on non-Windows platforms', async () => {
  let invocation;
  await verifyCodexPrerequisites({
    environment: { PATH: '/usr/bin', SHELL: '/bin/zsh' },
    platform: 'linux',
    execFileImplementation: (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(null, 'codex-cli 1.2.3\n', '');
    },
  });

  assert.equal(invocation.file, '/bin/zsh');
  assert.deepEqual(invocation.args, ['-lc', 'codex --version']);
});

test('prepares a session without loading a separate environment', async () => {
  const environment = { ComSpec: 'cmd.exe', PATH: 'system-path' };
  const invocations = [];
  const options = await prepareCodexSessionOptions({
    cwd: 'C:\\project',
    environment,
    platform: 'win32',
    execFileImplementation: (file, args, execOptions, callback) => {
      invocations.push({ file, args, execOptions });
      callback(null, 'codex-cli 1.2.3\n', '');
    },
  });

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].file, 'cmd.exe');
  assert.equal(options.cwd, 'C:\\project');
  assert.equal(options.env, environment);
  assert.deepEqual(options.args, ['/d', '/s', '/c', 'codex']);
});

test('returns a useful error when Codex is unavailable on PATH', async () => {
  await assert.rejects(
    verifyCodexPrerequisites({
      execFileImplementation: (_file, _args, _options, callback) =>
        callback(new Error('command failed'), '', "'codex' is not recognized"),
    }),
    {
      message: /Codex CLI was not found on PATH.*normal terminal.*restart Agenza/,
    },
  );
});
