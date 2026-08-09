const { contextBridge, ipcRenderer } = require('electron');

const { TERMINAL_CHANNELS } = require('./terminal/ipc-channels');

const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') {
    throw new TypeError('Terminal subscription requires a callback.');
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const terminalApi = Object.freeze({
  start: () => ipcRenderer.invoke(TERMINAL_CHANNELS.start),
  write: (id, data) => ipcRenderer.send(TERMINAL_CHANNELS.input, { id, data }),
  resize: (id, columns, rows) => ipcRenderer.send(TERMINAL_CHANNELS.resize, { id, columns, rows }),
  onData: (callback) => subscribe(TERMINAL_CHANNELS.data, callback),
  onExit: (callback) => subscribe(TERMINAL_CHANNELS.exit, callback),
});

contextBridge.exposeInMainWorld(
  'agenza',
  Object.freeze({
    platform: process.platform,
    terminal: terminalApi,
  }),
);
