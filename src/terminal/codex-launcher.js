const { execFile } = require('node:child_process');

const PREREQUISITE_TIMEOUT_MS = 15000;

const findEnvironmentValue = (environment, name) =>
  Object.entries(environment).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

const createCodexSessionOptions = ({
  cwd = process.cwd(),
  environment = process.env,
  platform = process.platform,
} = {}) => ({
  shell:
    findEnvironmentValue(environment, 'ComSpec') ||
    (platform === 'win32' ? 'cmd.exe' : environment.SHELL || '/bin/sh'),
  args: platform === 'win32' ? ['/d', '/s', '/c', 'codex'] : ['-lc', 'exec codex'],
  cwd,
  env: environment,
  useConpty: platform === 'win32',
});

const verifyCodexPrerequisites = ({
  cwd = process.cwd(),
  environment = process.env,
  execFileImplementation = execFile,
  platform = process.platform,
  timeout = PREREQUISITE_TIMEOUT_MS,
} = {}) =>
  new Promise((resolve, reject) => {
    const shell =
      findEnvironmentValue(environment, 'ComSpec') ||
      (platform === 'win32' ? 'cmd.exe' : environment.SHELL || '/bin/sh');
    const args =
      platform === 'win32' ? ['/d', '/s', '/c', 'codex --version'] : ['-lc', 'codex --version'];

    execFileImplementation(
      shell,
      args,
      { cwd, env: environment, timeout, windowsHide: true },
      (error, stdout = '') => {
        if (error) {
          reject(
            new Error(
              'Codex CLI was not found on PATH. Install Codex CLI, make "codex" available in a normal terminal, and restart Agenza.',
            ),
          );
          return;
        }

        resolve({ version: stdout.trim() });
      },
    );
  });

const prepareCodexSessionOptions = async (options = {}) => {
  await verifyCodexPrerequisites(options);
  return createCodexSessionOptions(options);
};

module.exports = {
  PREREQUISITE_TIMEOUT_MS,
  createCodexSessionOptions,
  prepareCodexSessionOptions,
  verifyCodexPrerequisites,
};
