const { PROJECT_WORKSPACE_ID_PATTERN } = require('./project-workspace-state');
const { PROJECT_WORKSPACE_CHANNELS } = require('./ipc-channels');

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const assertWorkspaceIdPayload = (payload) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !PROJECT_WORKSPACE_ID_PATTERN.test(payload.workspaceId ?? '')
  ) {
    throw new Error('Select a valid project workspace.');
  }
  return payload.workspaceId;
};

const registerProjectWorkspaceIpc = ({ dialog, ipcMain, service, window } = {}) => {
  if (!dialog || !ipcMain || !service || !window) {
    throw new TypeError('Project workspace IPC requires dialog, service, and window.');
  }

  const requireTrusted = (event) => {
    if (!isTrustedEvent(event, window)) throw new Error('Untrusted project workspace request.');
  };

  const handleList = (event) => {
    requireTrusted(event);
    return service.list();
  };
  const handleAdd = async (event) => {
    requireTrusted(event);
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Add a project workspace',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, catalog: service.list() };
    }
    await service.add(result.filePaths[0]);
    return { canceled: false, catalog: service.list() };
  };
  const handleActivate = async (event, payload) => {
    requireTrusted(event);
    return service.activate(assertWorkspaceIdPayload(payload));
  };
  const handleCreateTerminal = async (event, payload) => {
    requireTrusted(event);
    return service.createTerminal(assertWorkspaceIdPayload(payload));
  };

  ipcMain.handle(PROJECT_WORKSPACE_CHANNELS.list, handleList);
  ipcMain.handle(PROJECT_WORKSPACE_CHANNELS.add, handleAdd);
  ipcMain.handle(PROJECT_WORKSPACE_CHANNELS.activate, handleActivate);
  ipcMain.handle(PROJECT_WORKSPACE_CHANNELS.createTerminal, handleCreateTerminal);

  return () => {
    ipcMain.removeHandler(PROJECT_WORKSPACE_CHANNELS.list);
    ipcMain.removeHandler(PROJECT_WORKSPACE_CHANNELS.add);
    ipcMain.removeHandler(PROJECT_WORKSPACE_CHANNELS.activate);
    ipcMain.removeHandler(PROJECT_WORKSPACE_CHANNELS.createTerminal);
  };
};

module.exports = {
  assertWorkspaceIdPayload,
  isTrustedEvent,
  registerProjectWorkspaceIpc,
};
