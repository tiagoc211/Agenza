const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'agenza',
  Object.freeze({
    platform: process.platform,
  }),
);
