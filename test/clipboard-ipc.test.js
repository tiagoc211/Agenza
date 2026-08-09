const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_CLIPBOARD_TEXT_LENGTH,
  registerClipboardIpc,
} = require('../src/clipboard/clipboard-ipc');
const { CLIPBOARD_CHANNELS } = require('../src/clipboard/ipc-channels');

const createHarness = () => {
  const handlers = new Map();
  const removed = [];
  const mainFrame = {};
  const webContents = { mainFrame };
  const writes = [];
  const clipboard = {
    readText: () => 'copied output',
    writeText: (text) => writes.push(text),
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => removed.push(channel),
  };
  const window = { webContents };
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };

  return { clipboard, handlers, ipcMain, removed, trustedEvent, window, writes };
};

test('reads and writes clipboard text only for the owning renderer', async () => {
  const harness = createHarness();
  const dispose = registerClipboardIpc(harness);

  assert.equal(
    await harness.handlers.get(CLIPBOARD_CHANNELS.readText)(harness.trustedEvent),
    'copied output',
  );
  await harness.handlers.get(CLIPBOARD_CHANNELS.writeText)(harness.trustedEvent, {
    text: 'selected terminal text',
  });
  assert.deepEqual(harness.writes, ['selected terminal text']);

  assert.throws(
    () => harness.handlers.get(CLIPBOARD_CHANNELS.readText)({ sender: {}, senderFrame: {} }),
    /Untrusted clipboard read request/,
  );
  assert.throws(
    () =>
      harness.handlers.get(CLIPBOARD_CHANNELS.writeText)(
        { sender: {}, senderFrame: {} },
        { text: 'not allowed' },
      ),
    /Untrusted clipboard write request/,
  );

  dispose();
  assert.deepEqual(harness.removed, [CLIPBOARD_CHANNELS.readText, CLIPBOARD_CHANNELS.writeText]);
});

test('rejects invalid or excessively large clipboard writes', () => {
  const harness = createHarness();
  registerClipboardIpc(harness);
  const writeText = harness.handlers.get(CLIPBOARD_CHANNELS.writeText);

  assert.throws(
    () => writeText(harness.trustedEvent, { text: null }),
    /Clipboard text is invalid or too large/,
  );
  assert.throws(
    () => writeText(harness.trustedEvent, { text: 'x'.repeat(MAX_CLIPBOARD_TEXT_LENGTH + 1) }),
    /Clipboard text is invalid or too large/,
  );
});
