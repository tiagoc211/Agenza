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
  window.webContents.once('did-finish-load', async () => {
    if (isStartupCheck) {
      try {
        const layout = await window.webContents.executeJavaScript(`(() => {
          const grid = document.querySelector('.terminal-grid');
          return {
            terminalCount: document.querySelectorAll('.terminal-mount .xterm').length,
            activePaneCount: document.querySelectorAll('.terminal-pane.is-active').length,
            gridColumnCount: grid
              ? window.getComputedStyle(grid).gridTemplateColumns.split(' ').length
              : 0,
          };
        })()`);

        if (
          layout.terminalCount !== 2 ||
          layout.activePaneCount !== 1 ||
          layout.gridColumnCount !== 2
        ) {
          throw new Error(`Unexpected terminal layout: ${JSON.stringify(layout)}`);
        }

        console.log('Agenza startup check passed.');
        app.quit();
      } catch (error) {
        console.error('Agenza startup check failed:', error);
        app.exit(1);
      }
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
