const { ORCHESTRATION_CHANNELS } = require('./ipc-channels');

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const registerOrchestrationIpc = ({ ipcMain, service, window } = {}) => {
  if (!ipcMain || !service || !window) {
    throw new TypeError('Orchestration IPC requires ipcMain, a service, and a window.');
  }

  const trusted = (event) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted orchestration request.');
    }
  };
  const unsubscribeState = service.onStateChanged?.((payload) => {
    if (!window.isDestroyed?.() && !window.webContents.isDestroyed?.()) {
      window.webContents.send(ORCHESTRATION_CHANNELS.stateChanged, payload);
    }
  });

  const handleGetState = (event) => {
    trusted(event);
    return service.getState();
  };
  const handleSetOrchestrator = (event, payload) => {
    trusted(event);
    return service.setOrchestrator(payload?.id ?? null);
  };
  const handleCreateAgent = async (event) => {
    trusted(event);
    return service.createAgent();
  };
  const handleRemoveAgent = async (event, payload) => {
    trusted(event);
    return service.removeAgent(payload?.id);
  };
  const handleSendMessage = (event, payload) => {
    trusted(event);
    const { orchestratorId } = service.getState();
    if (!orchestratorId) {
      throw new Error('Select an orchestrator before sending an order.');
    }
    return service.sendMessage({
      message: payload?.message,
      requestedBy: orchestratorId,
      targetIds: payload?.targetIds,
    });
  };

  ipcMain.handle(ORCHESTRATION_CHANNELS.getState, handleGetState);
  ipcMain.handle(ORCHESTRATION_CHANNELS.setOrchestrator, handleSetOrchestrator);
  ipcMain.handle(ORCHESTRATION_CHANNELS.createAgent, handleCreateAgent);
  ipcMain.handle(ORCHESTRATION_CHANNELS.removeAgent, handleRemoveAgent);
  ipcMain.handle(ORCHESTRATION_CHANNELS.sendMessage, handleSendMessage);

  return () => {
    unsubscribeState?.();
    for (const channel of Object.values(ORCHESTRATION_CHANNELS)) {
      if (channel === ORCHESTRATION_CHANNELS.stateChanged) {
        continue;
      }
      ipcMain.removeHandler(channel);
    }
  };
};

module.exports = { isTrustedEvent, registerOrchestrationIpc };
