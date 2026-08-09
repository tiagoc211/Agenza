const assert = require('node:assert/strict');
const test = require('node:test');

const { TERMINAL_CHANNELS } = require('../src/terminal/ipc-channels');
const { MAX_INPUT_LENGTH, registerTerminalIpc } = require('../src/terminal/terminal-ipc');

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
    this.listeners = new Map();
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  on(channel, listener) {
    this.listeners.set(channel, listener);
  }

  removeListener(channel, listener) {
    if (this.listeners.get(channel) === listener) {
      this.listeners.delete(channel);
    }
  }
}

const createHarness = () => {
  const ipcMain = new FakeIpcMain();
  const sentMessages = [];
  const mainFrame = {};
  const webContents = {
    isDestroyed: () => false,
    mainFrame,
    send: (channel, payload) => sentMessages.push({ channel, payload }),
  };
  const window = {
    isDestroyed: () => false,
    webContents,
  };
  const dataListeners = new Map();
  const exitListeners = new Map();
  const writes = [];
  const resizes = [];
  let startCount = 0;
  let prepareCount = 0;
  let snapshots = [
    { id: 'terminal-one', isRunning: false },
    { id: 'terminal-two', isRunning: false },
  ];
  const subscribe = (listeners, id, listener) => {
    listeners.set(id, listener);
    return () => listeners.delete(id);
  };
  const manager = {
    getSnapshots: () => snapshots,
    onData: (id, listener) => subscribe(dataListeners, id, listener),
    onExit: (id, listener) => subscribe(exitListeners, id, listener),
    resize: (id, columns, rows) => resizes.push({ id, columns, rows }),
    startAll: () => {
      startCount += 1;
      snapshots = snapshots.map((snapshot, index) => ({
        ...snapshot,
        isRunning: true,
        pid: index + 100,
      }));
      return snapshots;
    },
    write: (id, data) => writes.push({ id, data }),
  };

  const dispose = registerTerminalIpc({
    ipcMain,
    manager,
    prepare: async () => {
      prepareCount += 1;
    },
    window,
  });

  return {
    dataListeners,
    dispose,
    exitListeners,
    ipcMain,
    manager,
    prepareCount: () => prepareCount,
    resizes,
    sentMessages,
    startCount: () => startCount,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
    writes,
  };
};

test('prepares and starts two sessions, then routes input and resize by terminal id', async () => {
  const harness = createHarness();
  const start = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.start);
  const input = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.input);
  const resize = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.resize);

  const snapshots = await start(harness.trustedEvent);
  input(harness.trustedEvent, { id: 'terminal-one', data: 'first' });
  input(harness.trustedEvent, { id: 'terminal-two', data: 'second' });
  resize(harness.trustedEvent, { id: 'terminal-two', columns: 120, rows: 40 });

  assert.equal(harness.startCount(), 1);
  assert.equal(harness.prepareCount(), 1);
  assert.deepEqual(
    snapshots.map(({ id, isRunning }) => ({ id, isRunning })),
    [
      { id: 'terminal-one', isRunning: true },
      { id: 'terminal-two', isRunning: true },
    ],
  );
  assert.deepEqual(harness.writes, [
    { id: 'terminal-one', data: 'first' },
    { id: 'terminal-two', data: 'second' },
  ]);
  assert.deepEqual(harness.resizes, [{ id: 'terminal-two', columns: 120, rows: 40 }]);

  harness.dispose();
});

test('forwards process output and exit events only with their source terminal id', () => {
  const harness = createHarness();

  harness.dataListeners.get('terminal-one')('output one');
  harness.dataListeners.get('terminal-two')('output two');
  harness.exitListeners.get('terminal-two')({ exitCode: 7, signal: 0 });

  assert.deepEqual(harness.sentMessages, [
    {
      channel: TERMINAL_CHANNELS.data,
      payload: { id: 'terminal-one', data: 'output one' },
    },
    {
      channel: TERMINAL_CHANNELS.data,
      payload: { id: 'terminal-two', data: 'output two' },
    },
    {
      channel: TERMINAL_CHANNELS.exit,
      payload: { id: 'terminal-two', exitCode: 7, signal: 0 },
    },
  ]);

  harness.dispose();
});

test('rejects invalid trusted payloads and ignores messages from other senders', () => {
  const harness = createHarness();
  const input = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.input);
  const resize = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.resize);
  const untrustedEvent = { sender: {}, senderFrame: {} };

  input(untrustedEvent, { id: 'terminal-one', data: 'ignored' });
  resize(untrustedEvent, { id: 'terminal-one', columns: 80, rows: 24 });

  assert.throws(
    () => input(harness.trustedEvent, { id: 'unknown', data: 'bad' }),
    /Invalid terminal session id/,
  );
  assert.throws(
    () =>
      input(harness.trustedEvent, { id: 'terminal-one', data: 'x'.repeat(MAX_INPUT_LENGTH + 1) }),
    /valid string/,
  );
  assert.throws(
    () => resize(harness.trustedEvent, { id: 'terminal-one', columns: 0, rows: 24 }),
    /valid terminal dimension/,
  );
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.resizes, []);

  harness.dispose();
});

test('removes IPC handlers and process subscriptions when disposed', () => {
  const harness = createHarness();

  harness.dispose();

  assert.equal(harness.ipcMain.handlers.size, 0);
  assert.equal(harness.ipcMain.listeners.size, 0);
  assert.equal(harness.dataListeners.size, 0);
  assert.equal(harness.exitListeners.size, 0);
});
