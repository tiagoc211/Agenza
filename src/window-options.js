const createWindowOptions = (preloadPath) => ({
  width: 1200,
  height: 760,
  minWidth: 800,
  minHeight: 500,
  backgroundColor: '#10141c',
  show: true,
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  },
});

module.exports = { createWindowOptions };
