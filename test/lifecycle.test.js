const assert = require('node:assert/strict');
const test = require('node:test');

const { createResourceDisposer } = require('../src/lifecycle/resource-disposer');
const {
  PROCESS_NOT_FOUND_STATUS,
  isProcessRunning,
  killProcessTree,
  resolveTaskkillExecutable,
} = require('../src/terminal/process-tree');

test('runs every lifecycle disposer once even when one fails', () => {
  const calls = [];
  const dispose = createResourceDisposer([
    { dispose: () => calls.push('ipc'), label: 'ipc' },
    {
      dispose: () => {
        calls.push('folder');
        throw new Error('folder failed');
      },
      label: 'folder',
    },
    { dispose: () => calls.push('terminals'), label: 'terminals' },
  ]);

  const errors = dispose();

  assert.deepEqual(calls, ['ipc', 'folder', 'terminals']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].label, 'folder');
  assert.deepEqual(dispose(), []);
  assert.deepEqual(calls, ['ipc', 'folder', 'terminals']);
});

test('terminates a Windows process and its descendants with the system taskkill', () => {
  let invocation;
  const result = killProcessTree(4321, {
    environment: { SystemRoot: 'C:\\Windows' },
    execFileSyncImplementation: (file, args, options) => {
      invocation = { args, file, options };
    },
    platform: 'win32',
  });

  assert.equal(result, true);
  assert.equal(invocation.file, 'C:\\Windows\\System32\\taskkill.exe');
  assert.deepEqual(invocation.args, ['/PID', '4321', '/T', '/F']);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.stdio, 'ignore');
});

test('falls back to PTY cleanup when a process has already exited or is not on Windows', () => {
  const missingProcess = Object.assign(new Error('missing'), {
    status: PROCESS_NOT_FOUND_STATUS,
  });

  assert.equal(
    killProcessTree(4321, {
      execFileSyncImplementation: () => {
        throw missingProcess;
      },
      platform: 'win32',
    }),
    false,
  );
  assert.equal(killProcessTree(4321, { platform: 'linux' }), false);
});

test('rejects invalid pids and reports taskkill failures', () => {
  assert.throws(() => killProcessTree(0), /positive integer pid/);
  assert.throws(
    () =>
      killProcessTree(4321, {
        execFileSyncImplementation: () => {
          throw new Error('access denied');
        },
        platform: 'win32',
      }),
    /Unable to terminate process tree 4321/,
  );
  assert.equal(resolveTaskkillExecutable({}), 'taskkill.exe');
});

test('checks whether a lifecycle pid still exists', () => {
  assert.equal(
    isProcessRunning(1234, () => {}),
    true,
  );
  assert.equal(
    isProcessRunning(1234, () => {
      throw Object.assign(new Error('missing'), { code: 'ESRCH' });
    }),
    false,
  );
  assert.equal(
    isProcessRunning(1234, () => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    }),
    true,
  );
  assert.throws(() => isProcessRunning(-1), /positive integer pid/);
});
