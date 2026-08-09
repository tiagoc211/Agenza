const { app, BrowserWindow, ipcMain } = require('electron');
const startedByInstaller = require('electron-squirrel-startup');

const { prepareCodexSessionOptions } = require('./terminal/codex-launcher');
const { DEFAULT_SESSION_IDS, TerminalManager } = require('./terminal/terminal-manager');
const { registerTerminalIpc } = require('./terminal/terminal-ipc');
const { createWindowOptions } = require('./window-options');

const isStartupCheck = process.argv.includes('--startup-check');
const STARTUP_CHECK_EXIT_TIMEOUT_MS = 5000;
const startupCheckLog = (...values) => {
  if (isStartupCheck) {
    console.log('[startup-check]', ...values);
  }
};

startupCheckLog('argv', process.argv);

const stopTerminalSessionsGracefully = (terminalManager) =>
  Promise.all(
    terminalManager
      .getSnapshots()
      .filter((snapshot) => snapshot.isRunning)
      .map(
        ({ id }) =>
          new Promise((resolve) => {
            let unsubscribe = () => {};
            const timeout = setTimeout(() => {
              unsubscribe();
              resolve();
            }, STARTUP_CHECK_EXIT_TIMEOUT_MS);

            unsubscribe = terminalManager.onExit(id, () => {
              clearTimeout(timeout);
              unsubscribe();
              resolve();
            });
            terminalManager.write(id, 'exit\r');
          }),
      ),
  );

if (startedByInstaller) {
  app.quit();
}

const createMainWindow = () => {
  startupCheckLog('creating window');
  const window = new BrowserWindow(createWindowOptions(MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY));
  const terminalManager = new TerminalManager();
  const disposeTerminalIpc = registerTerminalIpc({
    ipcMain,
    window,
    manager: terminalManager,
    prepare: isStartupCheck
      ? undefined
      : async () => {
          const sessionOptions = await prepareCodexSessionOptions();
          return Object.fromEntries(DEFAULT_SESSION_IDS.map((id) => [id, sessionOptions]));
        },
  });

  window.setMenuBarVisibility(false);
  window.webContents.once('did-finish-load', async () => {
    startupCheckLog('renderer loaded');
    if (isStartupCheck) {
      try {
        const layout = await window.webContents.executeJavaScript(`(async () => {
          const deadline = Date.now() + 15000;
          while (
            document.querySelectorAll('[data-session-state="connected"]').length !== 2 &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          const firstMarker = 'AGENZA_T006_TERMINAL_ONE';
          const secondMarker = 'AGENZA_T006_TERMINAL_TWO';
          window.agenza.terminal.write(
            'terminal-one',
            "Write-Output '" + firstMarker + "'\\r",
          );
          window.agenza.terminal.write(
            'terminal-two',
            "Write-Output '" + secondMarker + "'\\r",
          );

          const getTerminalText = (id) =>
            document.querySelector('#' + id + ' .xterm-rows')?.textContent ?? '';
          const outputDeadline = Date.now() + 10000;
          while (
            (!getTerminalText('terminal-one').includes(firstMarker) ||
              !getTerminalText('terminal-two').includes(secondMarker)) &&
            Date.now() < outputDeadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          const firstTerminalText = getTerminalText('terminal-one');
          const secondTerminalText = getTerminalText('terminal-two');
          const grid = document.querySelector('.terminal-grid');
          return {
            terminalCount: document.querySelectorAll('.terminal-mount .xterm').length,
            activePaneCount: document.querySelectorAll('.terminal-pane.is-active').length,
            connectedPaneCount: document.querySelectorAll(
              '[data-session-state="connected"]',
            ).length,
            gridColumnCount: grid
              ? window.getComputedStyle(grid).gridTemplateColumns.split(' ').length
              : 0,
            firstOutputIsIsolated:
              firstTerminalText.includes(firstMarker) &&
              !firstTerminalText.includes(secondMarker),
            secondOutputIsIsolated:
              secondTerminalText.includes(secondMarker) &&
              !secondTerminalText.includes(firstMarker),
          };
        })()`);

        if (
          layout.terminalCount !== 2 ||
          layout.activePaneCount !== 1 ||
          layout.connectedPaneCount !== 2 ||
          layout.gridColumnCount !== 2 ||
          !layout.firstOutputIsIsolated ||
          !layout.secondOutputIsIsolated
        ) {
          throw new Error(`Unexpected terminal layout: ${JSON.stringify(layout)}`);
        }

        console.log('Agenza startup check passed.');
        await stopTerminalSessionsGracefully(terminalManager);
        process.exit(0);
      } catch (error) {
        console.error('Agenza startup check failed:', error);
        await stopTerminalSessionsGracefully(terminalManager);
        process.exit(1);
      }
    }
  });
  window.once('closed', () => {
    disposeTerminalIpc();
    terminalManager.dispose();
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
