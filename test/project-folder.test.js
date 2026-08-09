const assert = require('node:assert/strict');
const test = require('node:test');

const { PROJECT_CHANNELS } = require('../src/project/ipc-channels');
const {
  registerProjectFolderIpc,
  validateProjectFolder,
} = require('../src/project/project-folder');

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

test('accepts only accessible absolute directories', async () => {
  const fileSystem = {
    access: async () => undefined,
    stat: async () => ({ isDirectory: () => true }),
  };

  assert.equal(await validateProjectFolder('C:\\project', { fileSystem }), 'C:\\project');
  await assert.rejects(validateProjectFolder('relative-folder', { fileSystem }), /valid absolute/);
  await assert.rejects(
    validateProjectFolder('C:\\missing', {
      fileSystem: {
        access: async () => undefined,
        stat: async () => {
          throw new Error('missing');
        },
      },
    }),
    /not accessible/,
  );
  await assert.rejects(
    validateProjectFolder('C:\\file.txt', {
      fileSystem: {
        access: async () => undefined,
        stat: async () => ({ isDirectory: () => false }),
      },
    }),
    /not accessible/,
  );
});

test('selects a validated folder only for the owning renderer', async () => {
  const ipcMain = new FakeIpcMain();
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { webContents };
  const selection = registerProjectFolderIpc({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\project'] }),
    },
    folderIds: ['terminal-one', 'terminal-two'],
    ipcMain,
    validate: async (folder) => folder,
    window,
  });
  const selectFolder = ipcMain.handlers.get(PROJECT_CHANNELS.selectFolder);
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };

  assert.deepEqual(await selectFolder(trustedEvent, { id: 'terminal-one' }), {
    canceled: false,
    id: 'terminal-one',
    path: 'C:\\project',
  });
  assert.equal(selection.getCurrentFolder('terminal-one'), 'C:\\project');
  assert.equal(selection.getCurrentFolder('terminal-two'), null);
  await assert.rejects(
    selectFolder({ sender: {}, senderFrame: {} }, { id: 'terminal-one' }),
    /Untrusted/,
  );
  await assert.rejects(selectFolder(trustedEvent, { id: 'terminal-three' }), /Invalid/);

  selection.dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test('keeps the current state unchanged when selection is canceled', async () => {
  const ipcMain = new FakeIpcMain();
  const mainFrame = {};
  const webContents = { mainFrame };
  const selection = registerProjectFolderIpc({
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    folderIds: ['terminal-one'],
    initialFolders: { 'terminal-one': 'C:\\existing' },
    ipcMain,
    window: { webContents },
  });
  const result = await ipcMain.handlers.get(PROJECT_CHANNELS.selectFolder)(
    {
      sender: webContents,
      senderFrame: mainFrame,
    },
    { id: 'terminal-one' },
  );

  assert.deepEqual(result, { canceled: true, id: 'terminal-one', path: 'C:\\existing' });
  assert.equal(selection.getCurrentFolder('terminal-one'), 'C:\\existing');
  selection.dispose();
});

test('accepts newly registered dynamic terminal ids and provides a smoke-test default folder', async () => {
  const ipcMain = new FakeIpcMain();
  const mainFrame = {};
  const webContents = { mainFrame };
  const activeIds = new Set(['terminal-dynamic-one']);
  const selection = registerProjectFolderIpc({
    defaultFolder: 'C:\\workspace',
    dialog: {
      showOpenDialog: async () => {
        throw new Error('The startup check should not open a dialog.');
      },
    },
    ipcMain,
    isValidFolderId: (id) => activeIds.has(id),
    skipDialog: true,
    window: { webContents },
  });
  const selectFolder = ipcMain.handlers.get(PROJECT_CHANNELS.selectFolder);
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };

  assert.deepEqual(await selectFolder(trustedEvent, { id: 'terminal-dynamic-one' }), {
    canceled: false,
    id: 'terminal-dynamic-one',
    path: 'C:\\workspace',
  });
  assert.equal(selection.getCurrentFolder('terminal-dynamic-one'), 'C:\\workspace');

  activeIds.delete('terminal-dynamic-one');
  await assert.rejects(
    selectFolder(trustedEvent, { id: 'terminal-dynamic-one' }),
    /Invalid terminal project id/,
  );
  selection.dispose();
});
