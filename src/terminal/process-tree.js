const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PROCESS_NOT_FOUND_STATUS = 128;

const getEnvironmentValue = (environment, name) =>
  Object.entries(environment).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

const resolveTaskkillExecutable = (environment = process.env) => {
  const systemRoot =
    getEnvironmentValue(environment, 'SystemRoot') || getEnvironmentValue(environment, 'WINDIR');

  return systemRoot && path.isAbsolute(systemRoot)
    ? path.join(systemRoot, 'System32', 'taskkill.exe')
    : 'taskkill.exe';
};

const isProcessRunning = (pid, killImplementation = process.kill) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new TypeError('A process check requires a positive integer pid.');
  }

  try {
    killImplementation(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false;
    }

    if (error?.code === 'EPERM') {
      return true;
    }

    throw error;
  }
};

const killProcessTree = (
  pid,
  {
    environment = process.env,
    execFileSyncImplementation = execFileSync,
    platform = process.platform,
  } = {},
) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new TypeError('A process tree requires a positive integer pid.');
  }

  if (platform !== 'win32') {
    return false;
  }

  try {
    execFileSyncImplementation(
      resolveTaskkillExecutable(environment),
      ['/PID', String(pid), '/T', '/F'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    return true;
  } catch (error) {
    if (error?.status === PROCESS_NOT_FOUND_STATUS) {
      return false;
    }

    throw new Error(`Unable to terminate process tree ${pid}.`, { cause: error });
  }
};

module.exports = {
  PROCESS_NOT_FOUND_STATUS,
  isProcessRunning,
  killProcessTree,
  resolveTaskkillExecutable,
};
