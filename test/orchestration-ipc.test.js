const assert = require('node:assert/strict');
const test = require('node:test');

const { ORCHESTRATION_CHANNELS } = require('../src/orchestration/ipc-channels');
const { registerOrchestrationIpc } = require('../src/orchestration/orchestration-ipc');

const createHarness = () => {
  const handlers = new Map();
  const sent = [];
  const webContents = {
    isDestroyed: () => false,
    mainFrame: {},
    send: (channel, payload) => sent.push({ channel, payload }),
  };
  const window = { isDestroyed: () => false, webContents };
  let listener;
  const service = {
    list: () => ({ orchestrations: [] }),
    start: (payload) => ({ id: 'started', ...payload }),
    stop: (id) => ({ id, status: 'stopped' }),
    onEvent: (callback) => {
      listener = callback;
      return () => {
        listener = null;
      };
    },
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const dispose = registerOrchestrationIpc({ ipcMain, service, window });
  return {
    dispose,
    handlers,
    sent,
    trustedEvent: { sender: webContents, senderFrame: webContents.mainFrame },
    emit: (payload) => listener(payload),
  };
};

test('exposes only validated orchestration intents to the owning renderer', async () => {
  const harness = createHarness();
  const started = await harness.handlers.get(ORCHESTRATION_CHANNELS.start)(harness.trustedEvent, {
    goal: 'Improve tests',
    options: { maxAgents: 2 },
    projectTerminalId: 'terminal-1',
  });
  assert.equal(started.goal, 'Improve tests');
  assert.throws(
    () =>
      harness.handlers.get(ORCHESTRATION_CHANNELS.start)(harness.trustedEvent, {
        goal: 'Unsafe',
        options: {},
        projectTerminalId: 'terminal-1',
        projectPath: 'C:\\arbitrary',
      }),
    /Invalid orchestration start/,
  );
  assert.throws(
    () => harness.handlers.get(ORCHESTRATION_CHANNELS.list)({ sender: {}, senderFrame: {} }),
    /Untrusted/,
  );
  harness.emit({ type: 'task:created' });
  assert.deepEqual(harness.sent, [
    { channel: ORCHESTRATION_CHANNELS.event, payload: { type: 'task:created' } },
  ]);
  harness.dispose();
  assert.equal(harness.handlers.size, 0);
});
