const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertWorkspaceIdPayload,
  registerProjectWorkspaceIpc,
} = require('../src/project-workspaces/project-workspace-ipc');
const { PROJECT_WORKSPACE_CHANNELS } = require('../src/project-workspaces/ipc-channels');

test('exposes only trusted workspace intents and never accepts renderer paths', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const frame = {};
  const webContents = { mainFrame: frame };
  const window = { webContents };
  const workspaceId = 'workspace-00000000-0000-4000-8000-000000000001';
  const calls = [];
  const service = {
    activate: async (id) => ({ activeWorkspaceId: id, workspaces: [] }),
    add: async (projectPath) => calls.push(projectPath),
    createTerminal: async (id) => ({ id: `terminal-for-${id}` }),
    list: () => ({ activeWorkspaceId: workspaceId, workspaces: [] }),
  };
  const dispose = registerProjectWorkspaceIpc({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\projects\\safe'] }),
    },
    ipcMain,
    service,
    window,
  });
  const trustedEvent = { sender: webContents, senderFrame: frame };
  const added = await handlers.get(PROJECT_WORKSPACE_CHANNELS.add)(trustedEvent);
  const terminal = await handlers.get(PROJECT_WORKSPACE_CHANNELS.createTerminal)(trustedEvent, {
    workspaceId,
  });

  assert.deepEqual(calls, ['C:\\projects\\safe']);
  assert.equal(added.canceled, false);
  assert.equal(terminal.id, `terminal-for-${workspaceId}`);
  assert.throws(
    () => assertWorkspaceIdPayload({ workspaceId, projectPath: 'C:\\unsafe' }),
    /valid project workspace/,
  );
  dispose();
  assert.equal(handlers.size, 0);
});
