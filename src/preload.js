const { contextBridge, ipcRenderer } = require('electron');

const { CLIPBOARD_CHANNELS } = require('./clipboard/ipc-channels');
const { GIT_CHANNELS } = require('./git/ipc-channels');
const { PROJECT_CHANNELS } = require('./project/ipc-channels');
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
  activate: (id) => ipcRenderer.invoke(TERMINAL_CHANNELS.activate, { id }),
  create: () => ipcRenderer.invoke(TERMINAL_CHANNELS.create),
  list: () => ipcRenderer.invoke(TERMINAL_CHANNELS.list),
  remove: (id) => ipcRenderer.invoke(TERMINAL_CHANNELS.remove, { id }),
  start: (id) => ipcRenderer.invoke(TERMINAL_CHANNELS.start, { id }),
  restart: (id) => ipcRenderer.invoke(TERMINAL_CHANNELS.restart, { id }),
  write: (id, data) => ipcRenderer.send(TERMINAL_CHANNELS.input, { id, data }),
  resize: (id, columns, rows) => ipcRenderer.send(TERMINAL_CHANNELS.resize, { id, columns, rows }),
  onData: (callback) => subscribe(TERMINAL_CHANNELS.data, callback),
  onExit: (callback) => subscribe(TERMINAL_CHANNELS.exit, callback),
});

const projectApi = Object.freeze({
  selectFolder: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.selectFolder, { id }),
});

const gitApi = Object.freeze({
  attachWorktree: (id, operationId) =>
    ipcRenderer.invoke(GIT_CHANNELS.attachWorktree, { id, operationId }),
  createExistingBranch: (id, operationId) =>
    ipcRenderer.invoke(GIT_CHANNELS.createExistingBranch, { id, operationId }),
  createNewBranch: (id, operationId) =>
    ipcRenderer.invoke(GIT_CHANNELS.createNewBranch, { id, operationId }),
  discover: (id) => ipcRenderer.invoke(GIT_CHANNELS.discover, { id }),
  planWorkspace: (id, request) => ipcRenderer.invoke(GIT_CHANNELS.planWorkspace, { id, request }),
  status: (id) => ipcRenderer.invoke(GIT_CHANNELS.status, { id }),
});

const clipboardApi = Object.freeze({
  readText: () => ipcRenderer.invoke(CLIPBOARD_CHANNELS.readText),
  writeText: (text) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, { text }),
});

contextBridge.exposeInMainWorld(
  'agenza',
  Object.freeze({
    clipboard: clipboardApi,
    git: gitApi,
    platform: process.platform,
    project: projectApi,
    terminal: terminalApi,
  }),
);
