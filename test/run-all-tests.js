const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

const run = (file, args) => {
  const result = spawnSync(file, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    console.error(`Unable to run ${file}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run(process.execPath, [path.join(__dirname, 'run-tests.js')]);

if (process.env.npm_execpath) {
  run(process.execPath, [process.env.npm_execpath, 'run', 'build']);
} else {
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
}

run(process.execPath, [path.join(__dirname, 'run-smoke-test.js')]);
console.log('All Agenza automated checks passed.');
