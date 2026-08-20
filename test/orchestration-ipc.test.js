const assert = require('node:assert/strict');
const test = require('node:test');

const { ORCHESTRATION_CHANNELS } = require('../src/orchestration/ipc-channels');
const { registerOrchestrationIpc } = require('../src/orchestration/orchestration-ipc');

test('exposes only trusted orchestration operations and sends UI orders as the selected orchestrator', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const mainFrame = {};
  const sent = [];
  const webContents = {
    isDestroyed: () => false,
    mainFrame,
    send: (channel, payload) => sent.push({ channel, payload }),
  };
  const window = { isDestroyed: () => false, webContents };
  const calls = [];
  let stateListener;
  let stateUnsubscribed = false;
  const service = {
    createAgent: async () => ({ snapshot: { id: 'created' } }),
    getState: () => ({ agents: [], orchestratorId: 'orchestrator' }),
    onStateChanged: (listener) => {
      stateListener = listener;
      return () => {
        stateUnsubscribed = true;
      };
    },
    removeAgent: async (id) => ({ id, removed: true }),
    sendMessage: (payload) => {
      calls.push(payload);
      return { recipientCount: 1 };
    },
    setOrchestrator: (id) => ({ agents: [], orchestratorId: id }),
  };
  const dispose = registerOrchestrationIpc({ ipcMain, service, window });
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };

  const state = await handlers.get(ORCHESTRATION_CHANNELS.setOrchestrator)(trustedEvent, {
    id: 'orchestrator',
  });
  assert.equal(state.orchestratorId, 'orchestrator');
  await handlers.get(ORCHESTRATION_CHANNELS.sendMessage)(trustedEvent, {
    message: 'Do the work',
    targetIds: ['worker'],
  });
  assert.deepEqual(calls, [
    { message: 'Do the work', requestedBy: 'orchestrator', targetIds: ['worker'] },
  ]);
  stateListener({ id: 'created', type: 'agent-created' });
  assert.deepEqual(sent, [
    {
      channel: ORCHESTRATION_CHANNELS.stateChanged,
      payload: { id: 'created', type: 'agent-created' },
    },
  ]);
  assert.throws(
    () => handlers.get(ORCHESTRATION_CHANNELS.getState)({ sender: {}, senderFrame: {} }),
    /Untrusted orchestration request/,
  );

  dispose();
  assert.equal(stateUnsubscribed, true);
  assert.equal(handlers.size, 0);
});

test('refuses a UI order until an orchestrator is selected', () => {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const mainFrame = {};
  const webContents = { mainFrame };
  const service = {
    getState: () => ({ agents: [], orchestratorId: null }),
  };
  registerOrchestrationIpc({ ipcMain, service, window: { webContents } });

  assert.throws(
    () =>
      handlers.get(ORCHESTRATION_CHANNELS.sendMessage)(
        { sender: webContents, senderFrame: mainFrame },
        { message: 'No source', targetIds: ['worker'] },
      ),
    /Select an orchestrator/,
  );
});
