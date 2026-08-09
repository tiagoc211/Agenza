const assert = require('node:assert/strict');
const test = require('node:test');

const { GIT_ERROR_CODES, GitDiscoveryError } = require('../src/git/git-command');
const { registerGitIpc } = require('../src/git/git-ipc');
const { GIT_CHANNELS } = require('../src/git/ipc-channels');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }
}

const createHarness = ({ currentFolder = 'C:\\repo', discoveryError = null } = {}) => {
  const ipcMain = new FakeIpcMain();
  const logs = [];
  const mainFrame = {};
  const webContents = { mainFrame };
  const repository = {
    branches: [],
    currentBranch: 'main',
    root: 'C:\\repo',
    worktrees: [],
  };
  const dispose = registerGitIpc({
    discover: async () => {
      if (discoveryError) {
        throw discoveryError;
      }

      return repository;
    },
    ipcMain,
    logger: {
      info: (event, details) => logs.push({ details, event, level: 'info' }),
      warn: (event, details) => logs.push({ details, event, level: 'warn' }),
    },
    window: { webContents },
    workspaceService: {
      getCurrentFolder: () => currentFolder,
      has: (id) => id === 'terminal-one' || id === 'terminal-two',
    },
  });

  return {
    discover: ipcMain.handlers.get(GIT_CHANNELS.discover),
    dispose,
    ipcMain,
    logs,
    repository,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
  };
};

test('discovers Git only for the selected folder belonging to the requesting terminal', async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.discover(harness.trustedEvent, { id: 'terminal-one' }), {
    id: 'terminal-one',
    ok: true,
    repository: harness.repository,
  });
  await assert.rejects(
    harness.discover({ sender: {}, senderFrame: {} }, { id: 'terminal-one' }),
    /Untrusted/,
  );
  await assert.rejects(
    harness.discover(harness.trustedEvent, { id: 'terminal-unknown' }),
    /Invalid terminal Git discovery id/,
  );
  assert.deepEqual(harness.logs, [
    {
      details: { terminalId: 'terminal-one' },
      event: 'git.discovery_requested',
      level: 'info',
    },
    {
      details: { terminalId: 'terminal-one' },
      event: 'git.discovery_succeeded',
      level: 'info',
    },
  ]);

  harness.dispose();
  assert.equal(harness.ipcMain.handlers.size, 0);
});

test('returns concise terminal-local errors for unavailable folders and Git failures', async () => {
  const unavailable = createHarness({ currentFolder: null });
  const missingGit = createHarness({
    discoveryError: new GitDiscoveryError(GIT_ERROR_CODES.missing),
  });

  assert.deepEqual(await unavailable.discover(unavailable.trustedEvent, { id: 'terminal-one' }), {
    error: {
      code: 'PROJECT_FOLDER_UNAVAILABLE',
      message: 'Select an accessible project folder before inspecting Git.',
    },
    id: 'terminal-one',
    ok: false,
  });
  const firstFailure = await missingGit.discover(missingGit.trustedEvent, { id: 'terminal-one' });
  const secondSuccess = await missingGit.discover(missingGit.trustedEvent, { id: 'terminal-two' });

  assert.equal(firstFailure.id, 'terminal-one');
  assert.equal(firstFailure.ok, false);
  assert.equal(firstFailure.error.code, GIT_ERROR_CODES.missing);
  assert.match(firstFailure.error.message, /Install Git/);
  assert.equal(secondSuccess.id, 'terminal-two');
  assert.equal(secondSuccess.ok, false);
  assert.equal(secondSuccess.error.code, GIT_ERROR_CODES.missing);

  unavailable.dispose();
  missingGit.dispose();
});
