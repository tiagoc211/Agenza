const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { killProcessTree } = require('../src/terminal/process-tree');

const SMOKE_TIMEOUT_MS = 60000;
const projectRoot = path.resolve(__dirname, '..');
const executablePath = path.join(projectRoot, 'out', 'Agenza-win32-x64', 'Agenza.exe');

if (process.platform !== 'win32') {
  console.error('The Agenza 0.1.0 smoke test requires Windows.');
  process.exit(1);
}

if (!fs.existsSync(executablePath)) {
  console.error('The packaged Agenza executable was not found. Run "npm run build" first.');
  process.exit(1);
}

const child = spawn(executablePath, ['--startup-check'], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: false,
});

let isComplete = false;
const finish = (exitCode) => {
  if (isComplete) {
    return;
  }

  isComplete = true;
  clearTimeout(timeout);
  process.exitCode = exitCode;
};

const timeout = setTimeout(() => {
  console.error(`Agenza smoke test exceeded ${SMOKE_TIMEOUT_MS / 1000} seconds.`);

  try {
    killProcessTree(child.pid);
  } catch (error) {
    console.error(`Unable to clean up the timed-out smoke test: ${error.message}`);
  }

  finish(1);
}, SMOKE_TIMEOUT_MS);

child.once('error', (error) => {
  console.error(`Unable to start the Agenza smoke test: ${error.message}`);
  finish(1);
});

child.once('exit', (code, signal) => {
  if (code === 0) {
    console.log('Packaged Agenza smoke test passed.');
    finish(0);
    return;
  }

  console.error(
    `Packaged Agenza smoke test failed (${signal ? `signal ${signal}` : `exit code ${code}`}).`,
  );
  finish(1);
});
