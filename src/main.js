const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const startedByInstaller = require('electron-squirrel-startup');

const { registerProjectFolderIpc } = require('./project/project-folder');
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
  const projectFolderIpc = registerProjectFolderIpc({
    dialog,
    folderIds: DEFAULT_SESSION_IDS,
    initialFolders: isStartupCheck
      ? Object.fromEntries(DEFAULT_SESSION_IDS.map((id) => [id, process.cwd()]))
      : {},
    ipcMain,
    skipDialog: isStartupCheck,
    window,
  });
  const disposeTerminalIpc = registerTerminalIpc({
    ipcMain,
    window,
    manager: terminalManager,
    prepare: isStartupCheck
      ? undefined
      : async (id) => {
          const projectFolder = projectFolderIpc.getCurrentFolder(id);

          if (!projectFolder) {
            throw new Error(`Select a project folder for "${id}" before starting Codex.`);
          }

          return prepareCodexSessionOptions({ cwd: projectFolder });
        },
  });

  window.setMenuBarVisibility(false);
  window.webContents.once('did-finish-load', async () => {
    startupCheckLog('renderer loaded');
    if (isStartupCheck) {
      try {
        const layout = await window.webContents.executeJavaScript(`(async () => {
          for (const id of ['terminal-one', 'terminal-two']) {
            document
              .querySelector('[data-pane-id="' + id + '"] [data-project-button]')
              ?.click();
          }

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
          const firstOutputIsIsolated =
            firstTerminalText.includes(firstMarker) &&
            !firstTerminalText.includes(secondMarker);
          const secondOutputIsIsolated =
            secondTerminalText.includes(secondMarker) &&
            !secondTerminalText.includes(firstMarker);

          document
            .querySelector('[data-pane-id="terminal-two"] [data-clear-button]')
            ?.click();
          const clearDeadline = Date.now() + 2000;
          while (
            getTerminalText('terminal-two').includes(secondMarker) &&
            Date.now() < clearDeadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const clearRemovedVisibleOutput = !getTerminalText('terminal-two').includes(secondMarker);

          window.agenza.terminal.write('terminal-one', 'exit\\r');
          const exitDeadline = Date.now() + 10000;
          const firstPane = document.querySelector('[data-pane-id="terminal-one"]');
          while (firstPane?.dataset.sessionState !== 'exited' && Date.now() < exitDeadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          const restartButton = firstPane?.querySelector('[data-restart-button]');
          const unexpectedExitWasShown = firstPane?.dataset.sessionState === 'exited';
          const restartWasAvailable = restartButton ? !restartButton.disabled : false;
          restartButton?.click();

          const restartDeadline = Date.now() + 15000;
          while (firstPane?.dataset.sessionState !== 'connected' && Date.now() < restartDeadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          const restartMarker = 'AGENZA_T009_RESTARTED_TERMINAL_ONE';
          window.agenza.terminal.write(
            'terminal-one',
            "Write-Output '" + restartMarker + "'\\r",
          );
          const restartOutputDeadline = Date.now() + 10000;
          while (
            !getTerminalText('terminal-one').includes(restartMarker) &&
            Date.now() < restartOutputDeadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

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
            clearRemovedVisibleOutput,
            firstOutputIsIsolated,
            restartOutputReceived: getTerminalText('terminal-one').includes(restartMarker),
            restartWasAvailable,
            secondOutputIsIsolated,
            secondTerminalStayedConnected:
              document.querySelector('[data-pane-id="terminal-two"]')?.dataset.sessionState ===
              'connected',
            unexpectedExitWasShown,
          };
        })()`);

        if (
          layout.terminalCount !== 2 ||
          layout.activePaneCount !== 1 ||
          layout.connectedPaneCount !== 2 ||
          layout.gridColumnCount !== 2 ||
          !layout.clearRemovedVisibleOutput ||
          !layout.firstOutputIsIsolated ||
          !layout.restartOutputReceived ||
          !layout.restartWasAvailable ||
          !layout.secondOutputIsIsolated ||
          !layout.secondTerminalStayedConnected ||
          !layout.unexpectedExitWasShown
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
    projectFolderIpc.dispose();
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
