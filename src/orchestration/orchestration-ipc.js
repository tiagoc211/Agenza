const { ORCHESTRATION_ID_PATTERN } = require('./orchestration-model');
const { ORCHESTRATION_CHANNELS } = require('./ipc-channels');
const { PROJECT_WORKSPACE_ID_PATTERN } = require('../project-workspaces/project-workspace-state');

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const assertExactKeys = (payload, expectedKeys, label) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify([...expectedKeys].sort())
  ) {
    throw new TypeError(`Invalid orchestration ${label} request.`);
  }
};

const registerOrchestrationIpc = ({ ipcMain, service, window } = {}) => {
  if (!ipcMain || !service || !window) {
    throw new TypeError('Orchestration IPC requires ipcMain, a service, and a window.');
  }

  const requireTrusted = (event, action) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error(`Untrusted orchestration ${action} request.`);
    }
  };
  const sendEvent = (payload) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(ORCHESTRATION_CHANNELS.event, payload);
    }
  };
  const unsubscribe = service.onEvent(sendEvent);

  const handleList = (event) => {
    requireTrusted(event, 'list');
    return service.list();
  };
  const handleStart = (event, payload) => {
    requireTrusted(event, 'start');
    assertExactKeys(payload, ['goal', 'options', 'projectWorkspaceId'], 'start');
    if (!PROJECT_WORKSPACE_ID_PATTERN.test(payload.projectWorkspaceId ?? '')) {
      throw new TypeError('Invalid orchestration project workspace id.');
    }
    return service.start(payload);
  };
  const handleStop = (event, payload) => {
    requireTrusted(event, 'stop');
    assertExactKeys(payload, ['orchestrationId'], 'stop');
    if (!ORCHESTRATION_ID_PATTERN.test(payload.orchestrationId ?? '')) {
      throw new TypeError('Invalid orchestration stop id.');
    }
    return service.stop(payload.orchestrationId);
  };

  ipcMain.handle(ORCHESTRATION_CHANNELS.list, handleList);
  ipcMain.handle(ORCHESTRATION_CHANNELS.start, handleStart);
  ipcMain.handle(ORCHESTRATION_CHANNELS.stop, handleStop);

  return () => {
    unsubscribe();
    ipcMain.removeHandler(ORCHESTRATION_CHANNELS.list);
    ipcMain.removeHandler(ORCHESTRATION_CHANNELS.start);
    ipcMain.removeHandler(ORCHESTRATION_CHANNELS.stop);
  };
};

module.exports = { assertExactKeys, isTrustedEvent, registerOrchestrationIpc };
