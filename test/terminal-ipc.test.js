const assert = require('node:assert/strict');
const test = require('node:test');

const { TERMINAL_CHANNELS } = require('../src/terminal/ipc-channels');
const { MAX_INPUT_LENGTH, registerTerminalIpc } = require('../src/terminal/terminal-ipc');

const FIRST_ID = 'terminal-00000000-0000-4000-8000-000000000001';
const SECOND_ID = 'terminal-00000000-0000-4000-8000-000000000002';

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
  const logEntries = [];
  const sentMessages = [];
  let windowFocusCount = 0;
  const mainFrame = {};
  const webContents = {
    isDestroyed: () => false,
    mainFrame,
    send: (channel, payload) => sentMessages.push({ channel, payload }),
  };
  const window = {
    focus: () => {
      windowFocusCount += 1;
    },
    isDestroyed: () => false,
    webContents,
  };
  const dataListeners = new Set();
  const exitListeners = new Set();
  const writes = [];
  const resizes = [];
  const removedIds = [];
  const detachedIds = [];
  const activatedIds = [];
  let startCount = 0;
  let prepareCount = 0;
  let prepareError = null;
  let nextId = 3;
  let snapshots = [
    { id: FIRST_ID, isRunning: false, pid: null },
    { id: SECOND_ID, isRunning: false, pid: null },
  ];
  const subscribe = (listeners, listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const updateSnapshot = (id, update) => {
    snapshots = snapshots.map((snapshot) =>
      snapshot.id === id ? { ...snapshot, ...update } : snapshot,
    );
    return snapshots.find((snapshot) => snapshot.id === id);
  };
  const manager = {
    activate: async (id) => {
      activatedIds.push(id);
      return { activeTerminalId: id };
    },
    create: () => {
      const id = `terminal-00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
      const snapshot = { id, isRunning: false, pid: null };
      snapshots.push(snapshot);
      return snapshot;
    },
    detachWorkspace: async (id) => {
      detachedIds.push(id);
      return {
        ...updateSnapshot(id, { isRunning: false, pid: null }),
        workspace: { kind: 'unassigned', projectPath: null, repository: null },
        workspaceStatus: { status: 'unassigned' },
      };
    },
    getSnapshot: (id) => snapshots.find((snapshot) => snapshot.id === id),
    has: (id) => snapshots.some((snapshot) => snapshot.id === id),
    list: () => snapshots,
    onSessionData: (listener) => subscribe(dataListeners, listener),
    onSessionExit: (listener) => subscribe(exitListeners, listener),
    remove: (id) => {
      removedIds.push(id);
      snapshots = snapshots.filter((snapshot) => snapshot.id !== id);
    },
    resize: (id, columns, rows) => resizes.push({ id, columns, rows }),
    restart: async (id) => {
      startCount += 1;
      return updateSnapshot(id, { isRunning: true, pid: startCount + 300 });
    },
    start: (id) => {
      startCount += 1;
      return updateSnapshot(id, { isRunning: true, pid: startCount + 200 });
    },
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
    logger: {
      error: (event, details) => logEntries.push({ details, event, level: 'error' }),
      info: (event, details) => logEntries.push({ details, event, level: 'info' }),
      warn: (event, details) => logEntries.push({ details, event, level: 'warn' }),
    },
    manager,
    prepare: async () => {
      prepareCount += 1;

      if (prepareError) {
        throw prepareError;
      }
    },
    window,
  });

  return {
    activatedIds,
    dataListeners,
    detachedIds,
    dispose,
    exitListeners,
    ipcMain,
    logEntries,
    manager,
    prepareCount: () => prepareCount,
    removedIds,
    resizes,
    sentMessages,
    setPrepareError: (error) => {
      prepareError = error;
    },
    startCount: () => startCount,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
    windowFocusCount: () => windowFocusCount,
    writes,
  };
};

test('persists the active dynamic terminal and accepts an empty active selection', async () => {
  const harness = createHarness();
  const activate = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.activate);

  assert.deepEqual(await activate(harness.trustedEvent, { id: SECOND_ID }), {
    activeTerminalId: SECOND_ID,
  });
  assert.deepEqual(await activate(harness.trustedEvent, { id: null }), {
    activeTerminalId: null,
  });
  await assert.rejects(
    activate(harness.trustedEvent, { id: 'terminal-unknown' }),
    /Invalid terminal session id/,
  );
  assert.deepEqual(harness.activatedIds, [SECOND_ID, null]);

  harness.dispose();
});

test('creates and lists dynamic sessions only for the owning renderer', async () => {
  const harness = createHarness();
  const create = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.create);
  const list = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.list);
  const created = await create(harness.trustedEvent);

  assert.equal(created.id.endsWith('000000000003'), true);
  assert.deepEqual(
    (await list(harness.trustedEvent)).map(({ id }) => id),
    [FIRST_ID, SECOND_ID, created.id],
  );
  await assert.rejects(create({ sender: {}, senderFrame: {} }), /Untrusted/);

  harness.dispose();
});

test('detaches stale workspace metadata through a narrow trusted operation', async () => {
  const harness = createHarness();
  const detachWorkspace = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.detachWorkspace);
  const result = await detachWorkspace(harness.trustedEvent, { id: FIRST_ID });

  assert.deepEqual(harness.detachedIds, [FIRST_ID]);
  assert.equal(result.id, FIRST_ID);
  assert.equal(result.workspace.kind, 'unassigned');
  assert.equal(harness.windowFocusCount(), 1);
  await assert.rejects(
    detachWorkspace({ sender: {}, senderFrame: {} }, { id: FIRST_ID }),
    /Untrusted/,
  );
  await assert.rejects(
    detachWorkspace(harness.trustedEvent, { id: 'terminal-unknown' }),
    /Invalid terminal session id/,
  );

  harness.dispose();
});

test('starts sessions and routes input and resize by dynamic terminal id', async () => {
  const harness = createHarness();
  const start = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.start);
  const input = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.input);
  const resize = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.resize);

  const snapshots = await start(harness.trustedEvent);
  input(harness.trustedEvent, { id: FIRST_ID, data: 'first' });
  input(harness.trustedEvent, { id: SECOND_ID, data: 'second' });
  resize(harness.trustedEvent, { id: SECOND_ID, columns: 120, rows: 40 });

  assert.equal(harness.startCount(), 1);
  assert.equal(harness.prepareCount(), 1);
  assert.equal(
    snapshots.every(({ isRunning }) => isRunning),
    true,
  );
  assert.deepEqual(harness.writes, [
    { id: FIRST_ID, data: 'first' },
    { id: SECOND_ID, data: 'second' },
  ]);
  assert.deepEqual(harness.resizes, [{ id: SECOND_ID, columns: 120, rows: 40 }]);

  harness.dispose();
});

test('forwards process output and exit events only with their source terminal id', () => {
  const harness = createHarness();
  const emitData = [...harness.dataListeners][0];
  const emitExit = [...harness.exitListeners][0];

  emitData({ id: FIRST_ID, data: 'output one' });
  emitData({ id: SECOND_ID, data: 'output two' });
  emitExit({ id: SECOND_ID, event: { exitCode: 7, signal: 0 } });

  assert.deepEqual(harness.sentMessages, [
    {
      channel: TERMINAL_CHANNELS.data,
      payload: { id: FIRST_ID, data: 'output one' },
    },
    {
      channel: TERMINAL_CHANNELS.data,
      payload: { id: SECOND_ID, data: 'output two' },
    },
    {
      channel: TERMINAL_CHANNELS.exit,
      payload: { id: SECOND_ID, exitCode: 7, signal: 0 },
    },
  ]);

  harness.dispose();
});

test('restarts and removes one dynamic terminal without changing another', async () => {
  const harness = createHarness();
  const start = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.start);
  const restart = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.restart);
  const remove = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.remove);

  await start(harness.trustedEvent, { id: FIRST_ID });
  const secondBeforeRestart = harness.manager.getSnapshot(SECOND_ID);
  const restarted = await restart(harness.trustedEvent, { id: FIRST_ID });
  const result = await remove(harness.trustedEvent, { id: FIRST_ID });

  assert.equal(restarted.id, FIRST_ID);
  assert.equal(restarted.isRunning, true);
  assert.deepEqual(harness.manager.getSnapshot(SECOND_ID), secondBeforeRestart);
  assert.deepEqual(result, { id: FIRST_ID, removed: true });
  assert.deepEqual(harness.removedIds, [FIRST_ID]);
  assert.equal(harness.windowFocusCount(), 1);
  assert.equal(harness.manager.has(FIRST_ID), false);
  assert.equal(harness.manager.has(SECOND_ID), true);

  harness.dispose();
});

test('keeps a startup failure isolated to its dynamic terminal', async () => {
  const harness = createHarness();
  const start = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.start);
  const startupError = new Error('Codex is unavailable');

  harness.setPrepareError(startupError);
  await assert.rejects(start(harness.trustedEvent, { id: FIRST_ID }), startupError);

  assert.equal(harness.manager.getSnapshot(FIRST_ID).isRunning, false);
  assert.equal(harness.manager.getSnapshot(SECOND_ID).isRunning, false);
  assert.deepEqual(
    harness.logEntries.find(({ event }) => event === 'terminal.start_failed'),
    {
      details: { error: startupError, terminalId: FIRST_ID },
      event: 'terminal.start_failed',
      level: 'error',
    },
  );

  harness.setPrepareError(null);
  const secondSession = await start(harness.trustedEvent, { id: SECOND_ID });

  assert.equal(secondSession.isRunning, true);
  assert.equal(harness.manager.getSnapshot(FIRST_ID).isRunning, false);
  assert.equal(harness.manager.getSnapshot(SECOND_ID).isRunning, true);

  harness.dispose();
});

test('rejects unknown trusted ids and unsafe payloads while ignoring other senders', async () => {
  const harness = createHarness();
  const input = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.input);
  const resize = harness.ipcMain.listeners.get(TERMINAL_CHANNELS.resize);
  const remove = harness.ipcMain.handlers.get(TERMINAL_CHANNELS.remove);
  const untrustedEvent = { sender: {}, senderFrame: {} };

  input(untrustedEvent, { id: FIRST_ID, data: 'ignored' });
  resize(untrustedEvent, { id: FIRST_ID, columns: 80, rows: 24 });

  assert.throws(
    () => input(harness.trustedEvent, { id: 'terminal-unknown', data: 'bad' }),
    /Invalid terminal session id/,
  );
  assert.throws(
    () => input(harness.trustedEvent, { id: FIRST_ID, data: 'x'.repeat(MAX_INPUT_LENGTH + 1) }),
    /valid string/,
  );
  assert.throws(
    () => resize(harness.trustedEvent, { id: FIRST_ID, columns: 0, rows: 24 }),
    /valid terminal dimension/,
  );
  await assert.rejects(
    remove(harness.trustedEvent, { id: 'terminal-unknown' }),
    /Invalid terminal session id/,
  );
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.resizes, []);

  harness.dispose();
});

test('removes every IPC handler and aggregate process subscription when disposed', () => {
  const harness = createHarness();

  harness.dispose();

  assert.equal(harness.ipcMain.handlers.size, 0);
  assert.equal(harness.ipcMain.listeners.size, 0);
  assert.equal(harness.dataListeners.size, 0);
  assert.equal(harness.exitListeners.size, 0);
});
