const { app, BrowserWindow } = require('electron');
const startedByInstaller = require('electron-squirrel-startup');

const { createWindowOptions } = require('./window-options');

const isStartupCheck = process.argv.includes('--startup-check');

if (startedByInstaller) {
  app.quit();
}

const createMainWindow = () => {
  const window = new BrowserWindow(createWindowOptions(MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY));

  window.setMenuBarVisibility(false);
  window.webContents.once('did-finish-load', () => {
    if (isStartupCheck) {
      console.log('Agenza startup check passed.');
      app.quit();
    }
  });
  window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  return window;
};

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
