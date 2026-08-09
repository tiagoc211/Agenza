const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  createCodexSessionOptions,
  loadCondaEnvironment,
  resolveCondaExecutable,
  verifyCodexPrerequisites,
} = require('../src/terminal/codex-launcher');

test('resolves Conda and creates an interactive Codex launch command', () => {
  const expectedConda = path.join('C:\\Users\\Test', 'anaconda3', 'Scripts', 'conda.exe');
  const condaExecutable = resolveCondaExecutable({
    environment: {},
    exists: (candidate) => candidate === expectedConda,
    homeDirectory: 'C:\\Users\\Test',
    platform: 'win32',
  });
  const options = createCodexSessionOptions({
    cwd: 'C:\\project',
    environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe', PATH: 'test-path' },
    platform: 'win32',
  });

  assert.equal(condaExecutable, expectedConda);
  assert.deepEqual(options, {
    shell: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'codex'],
    cwd: 'C:\\project',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe', PATH: 'test-path' },
    useConpty: true,
  });
});

test('loads the agenza environment with one short-lived Conda command', async () => {
  let invocation;
  const environment = await loadCondaEnvironment({
    condaExecutable: 'conda.exe',
    cwd: 'C:\\project',
    environment: { PATH: 'test-path' },
    execFileImplementation: (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(null, 'PATH=activated-path\r\nCONDA_DEFAULT_ENV=agenza\r\n', '');
    },
  });

  assert.deepEqual(invocation.args, ['run', '-n', 'agenza', 'cmd.exe', '/d', '/c', 'set']);
  assert.equal(invocation.file, 'conda.exe');
  assert.equal(invocation.options.windowsHide, true);
  assert.deepEqual(environment, { CONDA_DEFAULT_ENV: 'agenza', PATH: 'activated-path' });
});

test('verifies Codex using the activated environment before terminal startup', async () => {
  let invocation;
  const result = await verifyCodexPrerequisites({
    cwd: 'C:\\project',
    environment: { ComSpec: 'cmd.exe', PATH: 'activated-path' },
    execFileImplementation: (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(null, 'codex-cli 1.2.3\n', '');
    },
  });

  assert.deepEqual(invocation.args, ['/d', '/s', '/c', 'codex --version']);
  assert.equal(invocation.file, 'cmd.exe');
  assert.equal(invocation.options.env.PATH, 'activated-path');
  assert.equal(result.version, 'codex-cli 1.2.3');
});

test('returns useful errors for missing Conda, environment, and Codex', async () => {
  const loadFailure = (error, stderr = '') =>
    loadCondaEnvironment({
      execFileImplementation: (_file, _args, _options, callback) => callback(error, '', stderr),
    });
  const verifyFailure = (error, stderr = '') =>
    verifyCodexPrerequisites({
      execFileImplementation: (_file, _args, _options, callback) => callback(error, '', stderr),
    });

  await assert.rejects(loadFailure(Object.assign(new Error('spawn failed'), { code: 'ENOENT' })), {
    message: /Conda was not found/,
  });
  await assert.rejects(loadFailure(new Error('failed'), 'EnvironmentLocationNotFound: agenza'), {
    message: /environment "agenza" was not found/,
  });
  await assert.rejects(verifyFailure(new Error('failed'), "'codex' is not recognized"), {
    message: /Codex CLI could not be started/,
  });
});
