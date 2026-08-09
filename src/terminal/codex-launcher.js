const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONDA_ENVIRONMENT_NAME = 'agenza';
const PREREQUISITE_TIMEOUT_MS = 15000;

const resolveCondaExecutable = ({
  environment = process.env,
  exists = fs.existsSync,
  homeDirectory = os.homedir(),
  platform = process.platform,
} = {}) => {
  if (platform !== 'win32') {
    return environment.CONDA_EXE || 'conda';
  }

  const candidates = [
    environment.CONDA_EXE,
    environment.CONDA_ROOT && path.join(environment.CONDA_ROOT, 'Scripts', 'conda.exe'),
    path.join(homeDirectory, 'anaconda3', 'Scripts', 'conda.exe'),
    path.join(homeDirectory, 'miniconda3', 'Scripts', 'conda.exe'),
  ].filter(Boolean);

  return candidates.find((candidate) => exists(candidate)) || 'conda.exe';
};

const createCodexSessionOptions = ({
  cwd = process.cwd(),
  environment = process.env,
  platform = process.platform,
} = {}) => ({
  shell:
    Object.entries(environment).find(([key]) => key.toLowerCase() === 'comspec')?.[1] ||
    (platform === 'win32' ? 'cmd.exe' : environment.SHELL || '/bin/sh'),
  args: platform === 'win32' ? ['/d', '/s', '/c', 'codex'] : ['-lc', 'exec codex'],
  cwd,
  env: environment,
  useConpty: platform === 'win32',
});

const createPrerequisiteError = (error, stdout, stderr, environmentName) => {
  const details = [error?.message, stderr, stdout].filter(Boolean).join('\n');

  if (error?.code === 'ENOENT' && !/codex/i.test(details)) {
    return new Error(
      'Conda was not found. Install Conda or start Agenza from a terminal where conda is available.',
    );
  }

  if (/Environment(Location|Name)NotFound|not a conda environment/i.test(details)) {
    return new Error(
      `The Conda environment "${environmentName}" was not found. Create it before starting Agenza.`,
    );
  }

  if (/codex.*(not recognized|not found|cannot find|no such file)/i.test(details)) {
    return new Error(
      `Codex CLI was not found in the Conda environment "${environmentName}". Install Codex there and try again.`,
    );
  }

  return new Error(
    `Unable to start Codex through the Conda environment "${environmentName}". Run "conda run -n ${environmentName} codex --version" in a terminal for details.`,
  );
};

const runFile = ({
  args,
  cwd,
  environment,
  environmentName,
  execFileImplementation,
  file,
  timeout,
}) =>
  new Promise((resolve, reject) => {
    execFileImplementation(
      file,
      args,
      { cwd, env: environment, timeout, windowsHide: true },
      (error, stdout = '', stderr = '') => {
        if (error) {
          reject(createPrerequisiteError(error, stdout, stderr, environmentName));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });

const parseEnvironment = (output) =>
  Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => {
        const separator = line.indexOf('=');
        return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : null;
      })
      .filter(Boolean),
  );

const loadCondaEnvironment = async ({
  condaExecutable = resolveCondaExecutable(),
  cwd = process.cwd(),
  environment = process.env,
  environmentName = CONDA_ENVIRONMENT_NAME,
  execFileImplementation = execFile,
  timeout = PREREQUISITE_TIMEOUT_MS,
} = {}) => {
  const { stdout } = await runFile({
    args: ['run', '-n', environmentName, 'cmd.exe', '/d', '/c', 'set'],
    cwd,
    environment,
    environmentName,
    execFileImplementation,
    file: condaExecutable,
    timeout,
  });
  const activatedEnvironment = parseEnvironment(stdout);

  if (Object.keys(activatedEnvironment).length === 0) {
    throw new Error(
      `Conda did not return the environment variables for "${environmentName}". Start Agenza again from a normal terminal.`,
    );
  }

  return activatedEnvironment;
};

const verifyCodexPrerequisites = ({
  cwd = process.cwd(),
  environment = process.env,
  environmentName = CONDA_ENVIRONMENT_NAME,
  execFileImplementation = execFile,
  timeout = PREREQUISITE_TIMEOUT_MS,
} = {}) => {
  const commandProcessor =
    Object.entries(environment).find(([key]) => key.toLowerCase() === 'comspec')?.[1] || 'cmd.exe';

  return runFile({
    args: ['/d', '/s', '/c', 'codex --version'],
    cwd,
    environment,
    environmentName,
    execFileImplementation,
    file: commandProcessor,
    timeout,
  })
    .then(({ stdout }) => ({ environmentName, version: stdout.trim() }))
    .catch(() => {
      throw new Error(
        `Codex CLI could not be started in the Conda environment "${environmentName}". Install Codex there and try again.`,
      );
    });
};

const prepareCodexSessionOptions = async (options = {}) => {
  const environment = await loadCondaEnvironment(options);
  await verifyCodexPrerequisites({ ...options, environment });
  return createCodexSessionOptions({ ...options, environment });
};

module.exports = {
  CONDA_ENVIRONMENT_NAME,
  PREREQUISITE_TIMEOUT_MS,
  createCodexSessionOptions,
  loadCondaEnvironment,
  parseEnvironment,
  prepareCodexSessionOptions,
  resolveCondaExecutable,
  verifyCodexPrerequisites,
};
