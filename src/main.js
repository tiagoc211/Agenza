const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const startedByInstaller = require('electron-squirrel-startup');

const { registerClipboardIpc } = require('./clipboard/clipboard-ipc');
const { createResourceDisposer } = require('./lifecycle/resource-disposer');
const { createAppLogger, createNoopLogger } = require('./logging/app-logger');
const { registerProjectFolderIpc } = require('./project/project-folder');
const { prepareCodexSessionOptions } = require('./terminal/codex-launcher');
const { DEFAULT_SESSION_IDS, TerminalManager } = require('./terminal/terminal-manager');
const { registerTerminalIpc } = require('./terminal/terminal-ipc');
const { isProcessRunning, killProcessTree } = require('./terminal/process-tree');
const { createWindowOptions } = require('./window-options');

const isStartupCheck = process.argv.includes('--startup-check');
const isMissingCodexCheck = process.argv.includes('--missing-codex-check');
const STARTUP_CHECK_CHILD_TIMEOUT_MS = 10000;
let appLogger = createNoopLogger();
const startupCheckLog = (...values) => {
  if (isStartupCheck) {
    console.log('[startup-check]', ...values);
  }
};

startupCheckLog('argv', process.argv);

const startLifecycleChild = (terminalManager, id, marker) =>
  new Promise((resolve, reject) => {
    let output = '';
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Terminal "${id}" did not report its lifecycle child pid.`));
    }, STARTUP_CHECK_CHILD_TIMEOUT_MS);

    unsubscribe = terminalManager.onData(id, (data) => {
      output = `${output}${data}`.slice(-8192);
      const markerIndex = output.lastIndexOf(marker);

      if (markerIndex === -1) {
        return;
      }

      const pid = Number.parseInt(output.slice(markerIndex + marker.length), 10);

      if (!Number.isInteger(pid)) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();
      resolve(pid);
    });

    terminalManager.write(
      id,
      `$agenzaChild = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoLogo -NoProfile -Command Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru; Write-Output ('${marker}' + $agenzaChild.Id)\r`,
    );
  });

if (startedByInstaller) {
  app.quit();
}

const createMainWindow = () => {
  startupCheckLog('creating window');
  const window = new BrowserWindow(createWindowOptions(MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY));
  appLogger.info('window.created');
  const terminalManager = new TerminalManager();
  const disposeClipboardIpc = registerClipboardIpc({ clipboard, ipcMain, window });
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
    logger: appLogger,
    window,
    manager: terminalManager,
    prepare: isStartupCheck
      ? undefined
      : async (id) => {
          const projectFolder = projectFolderIpc.getCurrentFolder(id);

          if (!projectFolder) {
            throw new Error(`Select a project folder for "${id}" before starting Codex.`);
          }

          if (isMissingCodexCheck) {
            throw new Error(
              'Codex CLI was not found on PATH. Install Codex CLI, make "codex" available in a normal terminal, and restart Agenza.',
            );
          }

          return prepareCodexSessionOptions({ cwd: projectFolder });
        },
  });
  const disposeWindowResources = createResourceDisposer([
    { dispose: disposeTerminalIpc, label: 'terminal IPC' },
    { dispose: projectFolderIpc.dispose, label: 'project folder IPC' },
    { dispose: disposeClipboardIpc, label: 'clipboard IPC' },
    { dispose: () => terminalManager.dispose(), label: 'terminal process trees' },
  ]);

  window.once('close', () => {
    const disposalErrors = disposeWindowResources();

    if (disposalErrors.length > 0) {
      process.exitCode = 1;
      appLogger.error('window.cleanup_failed', {
        failures: disposalErrors.map(({ label, error }) => ({ error, label })),
      });

      if (isStartupCheck) {
        console.error(
          'Agenza could not clean up every window resource:',
          disposalErrors.map(({ label, error }) => `${label}: ${error.message}`).join('; '),
        );
      }
    } else {
      appLogger.info('window.closed');
    }
  });

  window.setMenuBarVisibility(false);
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }

      appLogger.error('window.load_failed', { errorCode, errorDescription });
      dialog.showErrorBox(
        'Agenza could not load',
        'Close and restart Agenza. If the problem continues, rebuild or reinstall the app and check agenza.log.',
      );
    },
  );
  window.webContents.once('did-finish-load', async () => {
    startupCheckLog('renderer loaded');
    appLogger.info('window.renderer_loaded');
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

          const keyboardFirstPane = document.querySelector(
            '[data-pane-id="terminal-one"]',
          );
          const keyboardSecondPane = document.querySelector(
            '[data-pane-id="terminal-two"]',
          );
          keyboardFirstPane?.querySelector('.xterm-helper-textarea')?.focus();
          document.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F6' }),
          );
          const focusMovedForward =
            keyboardSecondPane?.classList.contains('is-active') &&
            keyboardSecondPane.contains(document.activeElement);
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key: 'F6',
              shiftKey: true,
            }),
          );
          const focusMovedBackward =
            keyboardFirstPane?.classList.contains('is-active') &&
            keyboardFirstPane.contains(document.activeElement);
          const terminalShortcutEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: 'c',
          });
          document.dispatchEvent(terminalShortcutEvent);
          const terminalShortcutWasPreserved = !terminalShortcutEvent.defaultPrevented;

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
            focusMovedBackward,
            focusMovedForward,
            restartOutputReceived: getTerminalText('terminal-one').includes(restartMarker),
            restartWasAvailable,
            secondOutputIsIsolated,
            secondTerminalStayedConnected:
              document.querySelector('[data-pane-id="terminal-two"]')?.dataset.sessionState ===
              'connected',
            terminalShortcutWasPreserved,
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
          !layout.focusMovedBackward ||
          !layout.focusMovedForward ||
          !layout.restartOutputReceived ||
          !layout.restartWasAvailable ||
          !layout.secondOutputIsIsolated ||
          !layout.secondTerminalStayedConnected ||
          !layout.terminalShortcutWasPreserved ||
          !layout.unexpectedExitWasShown
        ) {
          throw new Error(`Unexpected terminal layout: ${JSON.stringify(layout)}`);
        }

        const lifecycleChildPids = await Promise.all([
          startLifecycleChild(terminalManager, 'terminal-one', 'AGENZA_T010_CHILD_ONE='),
          startLifecycleChild(terminalManager, 'terminal-two', 'AGENZA_T010_CHILD_TWO='),
        ]);
        startupCheckLog('lifecycle child pids', lifecycleChildPids);
        window.close();

        const orphanedPids = lifecycleChildPids.filter((pid) => isProcessRunning(pid));

        if (orphanedPids.length > 0) {
          console.error(`Agenza startup check left orphaned processes: ${orphanedPids.join(', ')}`);

          for (const pid of orphanedPids) {
            try {
              killProcessTree(pid);
            } catch {
              // The failed check has already been reported; make a best-effort final cleanup.
            }
          }
          app.exit(1);
        } else {
          console.log('Agenza startup check passed.');
          app.exit(0);
        }
      } catch (error) {
        console.error('Agenza startup check failed:', error);
        if (!window.isDestroyed()) {
          window.close();
        }
        app.exit(1);
      }
    }
  });
  window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  return window;
};

const handleStartupFailure = (error) => {
  appLogger.error('app.start_failed', { error });
  dialog.showErrorBox(
    'Agenza could not start',
    'Restart Agenza. If the problem continues, verify the installation and check agenza.log for diagnostics.',
  );
  app.exit(1);
};

app
  .whenReady()
  .then(() => {
    try {
      app.setAppLogsPath();
    } catch {
      // Electron may already have a logs path configured by the host environment.
    }

    appLogger = createAppLogger({ directory: app.getPath('logs') });
    startupCheckLog('diagnostic log', appLogger.filePath);
    appLogger.info('app.ready', { platform: process.platform, version: app.getVersion() });
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        try {
          createMainWindow();
        } catch (error) {
          handleStartupFailure(error);
        }
      }
    });
  })
  .catch(handleStartupFailure);

app.on('before-quit', () => {
  appLogger.info('app.quitting');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
