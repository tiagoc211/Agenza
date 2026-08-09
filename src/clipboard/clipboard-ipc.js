const { CLIPBOARD_CHANNELS } = require('./ipc-channels');

const MAX_CLIPBOARD_TEXT_LENGTH = 1_000_000;

const isTrustedEvent = (event, window) =>
  event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;

const registerClipboardIpc = ({ clipboard, ipcMain, window }) => {
  if (!clipboard || !ipcMain || !window) {
    throw new TypeError('Clipboard IPC requires clipboard, ipcMain, and a window.');
  }

  const readText = (event) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted clipboard read request.');
    }

    return clipboard.readText().slice(0, MAX_CLIPBOARD_TEXT_LENGTH);
  };

  const writeText = (event, payload) => {
    if (!isTrustedEvent(event, window)) {
      throw new Error('Untrusted clipboard write request.');
    }

    const { text } = payload ?? {};

    if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
      throw new Error('Clipboard text is invalid or too large.');
    }

    clipboard.writeText(text);
  };

  ipcMain.handle(CLIPBOARD_CHANNELS.readText, readText);
  ipcMain.handle(CLIPBOARD_CHANNELS.writeText, writeText);

  return () => {
    ipcMain.removeHandler(CLIPBOARD_CHANNELS.readText);
    ipcMain.removeHandler(CLIPBOARD_CHANNELS.writeText);
  };
};

module.exports = { MAX_CLIPBOARD_TEXT_LENGTH, registerClipboardIpc };
