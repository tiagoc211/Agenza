const { execFile } = require('node:child_process');

const DEFAULT_GIT_TIMEOUT_MS = 5000;
const DEFAULT_GIT_MAX_BUFFER = 1024 * 1024;
const MAX_GIT_ARGUMENTS = 32;
const MAX_GIT_ARGUMENT_LENGTH = 32767;

const GIT_ERROR_CODES = Object.freeze({
  commandFailed: 'GIT_COMMAND_FAILED',
  invalidRequest: 'INVALID_GIT_REQUEST',
  missing: 'GIT_NOT_FOUND',
  notRepository: 'NOT_GIT_REPOSITORY',
  outputLimit: 'GIT_OUTPUT_LIMIT',
  timeout: 'GIT_TIMEOUT',
  unexpectedOutput: 'UNEXPECTED_GIT_OUTPUT',
});

const GIT_ERROR_MESSAGES = Object.freeze({
  [GIT_ERROR_CODES.commandFailed]:
    'Agenza could not inspect this Git repository. Check it in a normal terminal and try again.',
  [GIT_ERROR_CODES.invalidRequest]: 'Agenza received an invalid Git discovery request.',
  [GIT_ERROR_CODES.missing]: 'Git was not found on PATH. Install Git and restart Agenza.',
  [GIT_ERROR_CODES.notRepository]: 'The selected folder is not inside a Git repository.',
  [GIT_ERROR_CODES.outputLimit]: 'Git returned too much repository data to inspect safely.',
  [GIT_ERROR_CODES.timeout]:
    'Git repository discovery timed out. Try again or inspect the repository in a normal terminal.',
  [GIT_ERROR_CODES.unexpectedOutput]:
    'Git returned repository information Agenza could not understand safely.',
});

class GitDiscoveryError extends Error {
  constructor(code, { cause } = {}) {
    super(GIT_ERROR_MESSAGES[code] ?? GIT_ERROR_MESSAGES[GIT_ERROR_CODES.commandFailed], { cause });
    this.name = 'GitDiscoveryError';
    this.code = code in GIT_ERROR_MESSAGES ? code : GIT_ERROR_CODES.commandFailed;
  }
}

const validateGitRequest = (args, cwd, timeoutMs, maxBuffer) => {
  if (
    !Array.isArray(args) ||
    args.length === 0 ||
    args.length > MAX_GIT_ARGUMENTS ||
    args.some(
      (argument) =>
        typeof argument !== 'string' ||
        argument.length === 0 ||
        argument.length > MAX_GIT_ARGUMENT_LENGTH,
    ) ||
    typeof cwd !== 'string' ||
    cwd.length === 0 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isInteger(maxBuffer) ||
    maxBuffer < 1
  ) {
    throw new GitDiscoveryError(GIT_ERROR_CODES.invalidRequest);
  }
};

const classifyGitFailure = (error, stderr) => {
  const errorText = `${error?.message ?? ''}\n${stderr ?? ''}`;

  if (error?.code === 'ENOENT') {
    return GIT_ERROR_CODES.missing;
  }

  if (
    error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
    /maxBuffer length exceeded/i.test(errorText)
  ) {
    return GIT_ERROR_CODES.outputLimit;
  }

  if (error?.killed || error?.code === 'ETIMEDOUT' || /timed out/i.test(errorText)) {
    return GIT_ERROR_CODES.timeout;
  }

  if (/not a git repository/i.test(errorText)) {
    return GIT_ERROR_CODES.notRepository;
  }

  return GIT_ERROR_CODES.commandFailed;
};

const runGit = (
  args,
  {
    allowedExitCodes = [0],
    cwd,
    execFileImpl = execFile,
    maxBuffer = DEFAULT_GIT_MAX_BUFFER,
    timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  } = {},
) => {
  validateGitRequest(args, cwd, timeoutMs, maxBuffer);

  if (
    !Array.isArray(allowedExitCodes) ||
    allowedExitCodes.length === 0 ||
    allowedExitCodes.some((code) => !Number.isInteger(code))
  ) {
    throw new GitDiscoveryError(GIT_ERROR_CODES.invalidRequest);
  }

  return new Promise((resolve, reject) => {
    execFileImpl(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout = '', stderr = '') => {
        const exitCode = error ? error.code : 0;

        if (!error || (Number.isInteger(exitCode) && allowedExitCodes.includes(exitCode))) {
          resolve({ exitCode, stderr: String(stderr), stdout: String(stdout) });
          return;
        }

        reject(new GitDiscoveryError(classifyGitFailure(error, stderr), { cause: error }));
      },
    );
  });
};

const toGitErrorPayload = (error) => {
  const normalizedError =
    error instanceof GitDiscoveryError
      ? error
      : new GitDiscoveryError(GIT_ERROR_CODES.commandFailed, { cause: error });

  return Object.freeze({ code: normalizedError.code, message: normalizedError.message });
};

module.exports = {
  DEFAULT_GIT_MAX_BUFFER,
  DEFAULT_GIT_TIMEOUT_MS,
  GIT_ERROR_CODES,
  GIT_ERROR_MESSAGES,
  GitDiscoveryError,
  runGit,
  toGitErrorPayload,
};
