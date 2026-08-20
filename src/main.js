const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const startedByInstaller = require('electron-squirrel-startup');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { registerClipboardIpc } = require('./clipboard/clipboard-ipc');
const { registerGitIpc } = require('./git/git-ipc');
const { inspectSavedGitWorkspace } = require('./git/git-workspace-recovery');
const { createResourceDisposer } = require('./lifecycle/resource-disposer');
const { createAppLogger, createNoopLogger } = require('./logging/app-logger');
const { installAgentCli } = require('./orchestration/agent-cli');
const { registerOrchestrationIpc } = require('./orchestration/orchestration-ipc');
const { OrchestrationService } = require('./orchestration/orchestration-service');
const { registerProjectFolderIpc } = require('./project/project-folder');
const { prepareCodexSessionOptions } = require('./terminal/codex-launcher');
const { TerminalManager } = require('./terminal/terminal-manager');
const { registerTerminalIpc } = require('./terminal/terminal-ipc');
const { isProcessRunning, killProcessTree } = require('./terminal/process-tree');
const { createWindowOptions } = require('./window-options');
const { WorkspaceService } = require('./workspace/workspace-service');
const { WORKSPACE_STATE_FILENAME, WorkspaceStateStore } = require('./workspace/workspace-state');

const isStartupCheck = process.argv.includes('--startup-check');
const isMissingCodexCheck = process.argv.includes('--missing-codex-check');
const STARTUP_CHECK_CHILD_TIMEOUT_MS = 10000;
let appLogger = createNoopLogger();
const startupCheckLog = (...values) => {
  if (isStartupCheck) {
    console.log('[startup-check]', ...values);
  }
};

const runStartupCheckGit = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });

const createStartupCheckRepository = (workspaceDirectory) => {
  const repositoryRoot = path.join(workspaceDirectory, 'repository');
  fs.mkdirSync(repositoryRoot, { recursive: true });
  runStartupCheckGit(['init', '--quiet', '--initial-branch=main'], repositoryRoot);
  runStartupCheckGit(['config', 'user.email', 'agenza-smoke@example.invalid'], repositoryRoot);
  runStartupCheckGit(['config', 'user.name', 'Agenza Smoke'], repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'README.md'), 'Agenza startup smoke repository.\n');
  runStartupCheckGit(['add', 'README.md'], repositoryRoot);
  runStartupCheckGit(
    ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial commit'],
    repositoryRoot,
  );

  return Object.freeze({
    repositoryRoot,
    worktreePaths: [
      path.join(workspaceDirectory, 'terminal-one-worktree'),
      path.join(workspaceDirectory, 'terminal-two-worktree'),
      path.join(workspaceDirectory, 'removed-terminal-worktree'),
    ],
  });
};

const waitForProcessesToStop = async (pids, timeoutMs = STARTUP_CHECK_CHILD_TIMEOUT_MS) => {
  const uniquePids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  const deadline = Date.now() + timeoutMs;
  let runningPids = uniquePids.filter((pid) => isProcessRunning(pid));

  while (runningPids.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    runningPids = uniquePids.filter((pid) => isProcessRunning(pid));
  }

  return runningPids;
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

const createMainWindow = async () => {
  startupCheckLog('creating window');
  const terminalManager = new TerminalManager();
  const workspaceDirectory = isStartupCheck
    ? path.join(app.getPath('temp'), 'Agenza', `startup-check-${process.pid}`)
    : app.getPath('userData');
  const startupCheckRepository = isStartupCheck
    ? createStartupCheckRepository(workspaceDirectory)
    : null;
  const workspaceService = new WorkspaceService({
    inspectGitWorkspace: inspectSavedGitWorkspace,
    stateStore: new WorkspaceStateStore({ directory: workspaceDirectory }),
    terminalManager,
  });
  await workspaceService.initialize();
  const orchestrationService = new OrchestrationService({
    terminalManager,
    workspaceService,
  });
  await orchestrationService.start();
  const agentCliDirectory = installAgentCli({ directory: workspaceDirectory });
  const window = new BrowserWindow(createWindowOptions(MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY));
  const prepareTerminal = isStartupCheck
    ? async () => undefined
    : async (id) => {
        const projectFolder = workspaceService.getCurrentFolder(id);

        if (!projectFolder) {
          throw new Error(`Select a project folder for "${id}" before starting Codex.`);
        }

        if (isMissingCodexCheck) {
          throw new Error(
            'Codex CLI was not found on PATH. Install Codex CLI, make "codex" available in a normal terminal, and restart Agenza.',
          );
        }

        return prepareCodexSessionOptions({
          cwd: projectFolder,
          environment: orchestrationService.createAgentEnvironment(
            id,
            process.env,
            agentCliDirectory,
          ),
        });
      };
  const startTerminal = async (id) => {
    const options = (await prepareTerminal(id)) ?? {};
    return terminalManager.getSnapshot(id).isRunning
      ? terminalManager.restart(id, options)
      : terminalManager.start(id, options);
  };
  appLogger.info('window.created');
  const disposeClipboardIpc = registerClipboardIpc({ clipboard, ipcMain, window });
  const disposeGitIpc = registerGitIpc({
    ipcMain,
    logger: appLogger,
    startTerminal,
    window,
    workspaceService,
  });
  const projectFolderIpc = registerProjectFolderIpc({
    defaultFolder: startupCheckRepository?.repositoryRoot ?? null,
    dialog,
    isValidFolderId: (id) => workspaceService.has(id),
    initialFolders: isStartupCheck ? {} : workspaceService.getInitialFolders(),
    ipcMain,
    onFolderSelected: (id, folder) => workspaceService.assignFolder(id, folder),
    skipDialog: isStartupCheck,
    window,
  });
  const disposeTerminalIpc = registerTerminalIpc({
    catalog: workspaceService,
    ipcMain,
    logger: appLogger,
    window,
    manager: terminalManager,
    prepare: prepareTerminal,
  });
  const disposeOrchestrationIpc = registerOrchestrationIpc({
    ipcMain,
    service: orchestrationService,
    window,
  });
  const disposeWindowResources = createResourceDisposer([
    { dispose: disposeOrchestrationIpc, label: 'orchestration IPC' },
    { dispose: disposeTerminalIpc, label: 'terminal IPC' },
    { dispose: projectFolderIpc.dispose, label: 'project folder IPC' },
    { dispose: disposeGitIpc, label: 'Git discovery IPC' },
    { dispose: disposeClipboardIpc, label: 'clipboard IPC' },
    { dispose: () => orchestrationService.dispose(), label: 'orchestration broker' },
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
          const waitFor = async (predicate, timeoutMs = 15000) => {
            const deadline = Date.now() + timeoutMs;

            while (!predicate() && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            return predicate();
          };
          const getPanes = () => [...document.querySelectorAll('.terminal-pane')];
          const getPane = (id) => getPanes().find((pane) => pane.dataset.paneId === id);
          const getIds = () => getPanes().map((pane) => pane.dataset.paneId);
          const getTerminalText = (id) =>
            getPane(id)?.querySelector('.xterm-rows')?.textContent ?? '';
          const paneHeaderHasNoOverlap = (pane) => {
            const header = pane.querySelector('.pane-header');
            const identity = pane.querySelector('.pane-identity');
            const actions = pane.querySelector('.pane-actions');

            if (!header || !identity || !actions) {
              return false;
            }

            const headerRect = header.getBoundingClientRect();
            const identityRect = identity.getBoundingClientRect();
            const actionsRect = actions.getBoundingClientRect();
            const controls = [...actions.children].map((element) =>
              element.getBoundingClientRect(),
            );
            const controlsDoNotIntersect = controls.every((first, index) =>
              controls.slice(index + 1).every(
                (second) =>
                  first.right <= second.left ||
                  second.right <= first.left ||
                  first.bottom <= second.top ||
                  second.bottom <= first.top,
              ),
            );

            return (
              identityRect.bottom <= actionsRect.top + 1 &&
              identityRect.right <= headerRect.right + 1 &&
              actionsRect.right <= headerRect.right + 1 &&
              actionsRect.bottom <= headerRect.bottom + 1 &&
              controlsDoNotIntersect
            );
          };
          const addTerminal = async () => {
            const previousCount = getPanes().length;
            document.querySelector('[data-add-terminal]')?.click();
            return waitFor(() => getPanes().length === previousCount + 1);
          };
          const removeTerminal = async (id) => {
            getPane(id)?.querySelector('[data-remove-button]')?.click();
            await waitFor(
              () => document.querySelector('[data-confirmation-dialog]')?.open === true,
            );
            document.querySelector('[data-confirm-action]')?.click();
            return waitFor(() => !getPane(id));
          };

          await waitFor(
            () => document.querySelector('[data-terminal-grid]')?.dataset.workspaceReady === 'true',
          );
          const initialIds = getIds();
          const initialLayoutHadTwo = initialIds.length === 2;

          await addTerminal();
          const severalLayoutHadThree = getPanes().length === 3;
          const severalHeadersAvoidedOverlap = getPanes().every(paneHeaderHasNoOverlap);
          const addedId = getIds().find((id) => !initialIds.includes(id));
          const grid = document.querySelector('[data-terminal-grid]');
          const firstInitialPane = getPane(initialIds[0]);
          const secondInitialPane = getPane(initialIds[1]);
          grid?.insertBefore(secondInitialPane, firstInitialPane);
          secondInitialPane?.querySelector('[data-project-button]')?.focus();
          document.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F6' }),
          );
          await new Promise((resolve) => setTimeout(resolve, 50));
          const reorderedFocusFollowedVisualOrder =
            firstInitialPane?.classList.contains('is-active') &&
            firstInitialPane.contains(document.activeElement);
          for (const id of [...initialIds, addedId]) {
            const pane = getPane(id);
            if (pane) {
              grid?.append(pane);
            }
          }
          await removeTerminal(addedId);
          const dynamicRemovalRestoredTwo = getPanes().length === 2;

          await removeTerminal(initialIds[0]);
          const onePaneUsedOneColumn =
            getPanes().length === 1 &&
            window
              .getComputedStyle(document.querySelector('[data-terminal-grid]'))
              .gridTemplateColumns.split(' ').length === 1;
          const onePaneHeaderAvoidedOverlap = getPanes().every(paneHeaderHasNoOverlap);
          document.querySelector('[data-add-terminal]')?.focus();
          document.dispatchEvent(
            new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F6' }),
          );
          await new Promise((resolve) => setTimeout(resolve, 50));
          const singlePaneFocusShortcutWorked =
            getPanes()[0]?.classList.contains('is-active') &&
            getPanes()[0]?.contains(document.activeElement);
          await removeTerminal(initialIds[1]);
          const emptyStateWasUsable =
            getPanes().length === 0 &&
            !document.querySelector('[data-empty-workspace]')?.hidden;

          await addTerminal();
          await addTerminal();
          const terminalIds = getIds();
          const stableLabels = terminalIds.map(
            (id) => getPane(id)?.querySelector('[data-terminal-title]')?.textContent,
          );

          for (const id of terminalIds) {
            getPane(id)?.querySelector('[data-project-button]')?.click();
          }

          await waitFor(
            () => document.querySelectorAll('[data-session-state="connected"]').length === 2,
          );
          await new Promise((resolve) => setTimeout(resolve, 250));

          const [firstId, secondId] = terminalIds;
          const firstMarker = 'AGENZA_T006_TERMINAL_ONE';
          const secondMarker = 'AGENZA_T006_TERMINAL_TWO';
          window.agenza.terminal.write(firstId, "Write-Output '" + firstMarker + "'\\r");
          window.agenza.terminal.write(secondId, "Write-Output '" + secondMarker + "'\\r");
          await waitFor(
            () =>
              getTerminalText(firstId).includes(firstMarker) &&
              getTerminalText(secondId).includes(secondMarker),
            10000,
          );

          const firstTerminalText = getTerminalText(firstId);
          const secondTerminalText = getTerminalText(secondId);
          const firstOutputIsIsolated =
            firstTerminalText.includes(firstMarker) &&
            !firstTerminalText.includes(secondMarker);
          const secondOutputIsIsolated =
            secondTerminalText.includes(secondMarker) &&
            !secondTerminalText.includes(firstMarker);

          const keyboardFirstPane = getPane(firstId);
          const keyboardSecondPane = getPane(secondId);
          const keyboardFirstInput = keyboardFirstPane?.querySelector('.xterm-helper-textarea');
          const keyboardSecondInput = keyboardSecondPane?.querySelector('.xterm-helper-textarea');
          keyboardFirstInput?.focus();
          await new Promise((resolve) => setTimeout(resolve, 50));
          const terminalForwardEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'F6',
          });
          keyboardFirstInput?.dispatchEvent(terminalForwardEvent);
          await new Promise((resolve) => setTimeout(resolve, 50));
          const focusMovedForward =
            terminalForwardEvent.defaultPrevented &&
            keyboardSecondPane?.classList.contains('is-active') &&
            keyboardSecondPane.contains(document.activeElement);
          const terminalBackwardEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'F6',
            shiftKey: true,
          });
          keyboardSecondInput?.dispatchEvent(terminalBackwardEvent);
          await new Promise((resolve) => setTimeout(resolve, 50));
          const focusMovedBackward =
            terminalBackwardEvent.defaultPrevented &&
            keyboardFirstPane?.classList.contains('is-active') &&
            keyboardFirstPane.contains(document.activeElement);
          const activeBeforeModifiedF6 = document.querySelector('.terminal-pane.is-active');
          const modifiedF6Event = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: 'F6',
          });
          document.dispatchEvent(modifiedF6Event);
          const modifiedF6WasPreserved =
            !modifiedF6Event.defaultPrevented &&
            activeBeforeModifiedF6 === document.querySelector('.terminal-pane.is-active');
          const terminalShortcutEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: 'c',
          });
          document.dispatchEvent(terminalShortcutEvent);
          const terminalShortcutWasPreserved = !terminalShortcutEvent.defaultPrevented;

          keyboardSecondPane?.querySelector('[data-clear-button]')?.click();
          await waitFor(() => !getTerminalText(secondId).includes(secondMarker), 2000);
          const clearRemovedVisibleOutput = !getTerminalText(secondId).includes(secondMarker);

          window.agenza.terminal.write(firstId, 'exit\\r');
          await waitFor(() => keyboardFirstPane?.dataset.sessionState === 'exited', 10000);
          const restartButton = keyboardFirstPane?.querySelector('[data-restart-button]');
          const unexpectedExitWasShown = keyboardFirstPane?.dataset.sessionState === 'exited';
          const restartWasAvailable = restartButton ? !restartButton.disabled : false;
          restartButton?.click();
          await waitFor(() => keyboardFirstPane?.dataset.sessionState === 'connected');

          const restartMarker = 'AGENZA_T009_RESTARTED_TERMINAL_ONE';
          window.agenza.terminal.write(firstId, "Write-Output '" + restartMarker + "'\\r");
          await waitFor(() => getTerminalText(firstId).includes(restartMarker), 10000);

          return {
            terminalIds,
            terminalLabels: stableLabels,
            activePaneCount: document.querySelectorAll('.terminal-pane.is-active').length,
            clearRemovedVisibleOutput,
            connectedPaneCount: document.querySelectorAll(
              '[data-session-state="connected"]',
            ).length,
            dynamicRemovalRestoredTwo,
            emptyStateWasUsable,
            firstOutputIsIsolated,
            focusMovedBackward,
            focusMovedForward,
            headersAvoidedOverlap:
              severalHeadersAvoidedOverlap &&
              onePaneHeaderAvoidedOverlap &&
              getPanes().every(paneHeaderHasNoOverlap),
            initialLayoutHadTwo,
            labelsStayedStable: terminalIds.every(
              (id, index) =>
                getPane(id)?.querySelector('[data-terminal-title]')?.textContent ===
                stableLabels[index],
            ),
            onePaneUsedOneColumn,
            reorderedFocusFollowedVisualOrder,
            restartOutputReceived: getTerminalText(firstId).includes(restartMarker),
            restartWasAvailable,
            secondOutputIsIsolated,
            secondTerminalStayedConnected:
              keyboardSecondPane?.dataset.sessionState === 'connected',
            severalLayoutHadThree,
            singlePaneFocusShortcutWorked,
            modifiedF6WasPreserved,
            terminalShortcutWasPreserved,
            unexpectedExitWasShown,
          };
        })()`);

        if (
          layout.terminalIds.length !== 2 ||
          layout.activePaneCount !== 1 ||
          layout.connectedPaneCount !== 2 ||
          !layout.clearRemovedVisibleOutput ||
          !layout.dynamicRemovalRestoredTwo ||
          !layout.emptyStateWasUsable ||
          !layout.firstOutputIsIsolated ||
          !layout.focusMovedBackward ||
          !layout.focusMovedForward ||
          !layout.headersAvoidedOverlap ||
          !layout.initialLayoutHadTwo ||
          !layout.labelsStayedStable ||
          !layout.onePaneUsedOneColumn ||
          !layout.reorderedFocusFollowedVisualOrder ||
          !layout.restartOutputReceived ||
          !layout.restartWasAvailable ||
          !layout.secondOutputIsIsolated ||
          !layout.secondTerminalStayedConnected ||
          !layout.severalLayoutHadThree ||
          !layout.singlePaneFocusShortcutWorked ||
          !layout.modifiedF6WasPreserved ||
          !layout.terminalShortcutWasPreserved ||
          !layout.unexpectedExitWasShown
        ) {
          throw new Error(`Unexpected terminal layout: ${JSON.stringify(layout)}`);
        }

        const workspaceCheck = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async (predicate, timeoutMs = 15000) => {
            const deadline = Date.now() + timeoutMs;

            while (!predicate() && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            return predicate();
          };
          const getPanes = () => [...document.querySelectorAll('.terminal-pane')];
          const getPane = (id) => getPanes().find((pane) => pane.dataset.paneId === id);
          const createTerminal = async () => {
            const knownIds = new Set(getPanes().map((pane) => pane.dataset.paneId));
            document.querySelector('[data-add-terminal]')?.click();
            await waitFor(() => getPanes().length === knownIds.size + 1);
            return getPanes().find((pane) => !knownIds.has(pane.dataset.paneId))?.dataset.paneId;
          };
          const assignWorktree = async (id, branch, worktreePath) => {
            const discovery = await window.agenza.git.discover(id);

            if (!discovery.ok) {
              throw new Error('Unable to discover the startup-check repository for ' + id + '.');
            }

            const previewResult = await window.agenza.git.planWorkspace(id, {
              baseBranch: discovery.repository.currentBranch,
              targetBranch: branch,
              type: 'create-new-branch-worktree',
              worktreePath,
            });

            if (!previewResult.ok) {
              throw new Error('Unable to preview a startup-check worktree for ' + id + '.');
            }

            const confirmation = await window.agenza.git.createNewBranch(
              id,
              previewResult.preview.operationId,
            );

            if (!confirmation.ok || confirmation.operation.workspace.projectPath !== worktreePath) {
              throw new Error('Unable to assign the startup-check worktree for ' + id + '.');
            }

            return Object.freeze({
              branch,
              id,
              sessionPid: confirmation.session?.pid ?? null,
              worktreePath: confirmation.operation.workspace.projectPath,
            });
          };

          const terminalIds = ${JSON.stringify(layout.terminalIds)};
          const worktreePaths = ${JSON.stringify(startupCheckRepository.worktreePaths)};
          const assignments = [];

          assignments.push(
            await assignWorktree(
              terminalIds[0],
              'agenza-smoke-terminal-one',
              worktreePaths[0],
            ),
          );
          assignments.push(
            await assignWorktree(
              terminalIds[1],
              'agenza-smoke-terminal-two',
              worktreePaths[1],
            ),
          );

          const removedTerminalId = await createTerminal();
          const removedTerminalPane = getPane(removedTerminalId);
          removedTerminalPane?.querySelector('[data-project-button]')?.click();
          await waitFor(
            () => removedTerminalPane?.dataset.sessionState === 'connected',
            10000,
          );
          const removedAssignment = await assignWorktree(
            removedTerminalId,
            'agenza-smoke-removed-terminal',
            worktreePaths[2],
          );
          removedTerminalPane?.querySelector('[data-remove-button]')?.click();
          await waitFor(
            () => document.querySelector('[data-confirmation-dialog]')?.open === true,
          );
          document.querySelector('[data-confirm-action]')?.click();
          const removedFromInterface = await waitFor(() => !getPane(removedTerminalId));
          const cleanupButton = document.querySelector('[data-cleanup-worktree]');
          await waitFor(() => cleanupButton?.disabled === false);
          cleanupButton?.click();
          const cleanupDialogOpened = await waitFor(
            () => document.querySelector('[data-cleanup-dialog]')?.open === true,
          );
          const cleanupSelect = document.querySelector('[data-cleanup-worktree-select]');
          const cleanupSelectFocused = await waitFor(
            () => document.activeElement === cleanupSelect,
          );
          const cleanupDropdownReadyAfterRemoval =
            cleanupDialogOpened &&
            cleanupSelectFocused &&
            document.hasFocus() &&
            !cleanupSelect?.disabled &&
            Boolean(cleanupSelect?.value) &&
            cleanupSelect.selectedOptions[0]?.textContent.includes(removedAssignment.worktreePath);
          const cleanupFocusDetails = {
            cleanupDialogOpened,
            cleanupSelectFocused,
            documentHasFocus: document.hasFocus(),
            selectDisabled: cleanupSelect?.disabled ?? null,
            selectedRemovedWorktree:
              cleanupSelect?.selectedOptions[0]?.textContent.includes(
                removedAssignment.worktreePath,
              ) ?? false,
            selectHasValue: Boolean(cleanupSelect?.value),
          };
          document.querySelector('[data-cancel-cleanup]')?.click();
          await waitFor(() => document.querySelector('[data-cleanup-dialog]')?.open === false);

          return {
            assignments,
            cleanupDropdownReadyAfterRemoval,
            cleanupFocusDetails,
            removedAssignment,
            removedFromInterface,
            removedTerminalId,
          };
        })()`);
        const assignedPaths = workspaceCheck.assignments.map(({ worktreePath }) => worktreePath);
        const allWorktreePaths = [...assignedPaths, workspaceCheck.removedAssignment.worktreePath];
        const registeredWorktrees = runStartupCheckGit(
          ['worktree', 'list', '--porcelain'],
          startupCheckRepository.repositoryRoot,
        );
        const canonicalizeWorktreePath = (worktreePath) =>
          path.resolve(worktreePath).replaceAll('/', '\\').toLowerCase();
        const registeredWorktreePaths = registeredWorktrees
          .split(/\r?\n/)
          .filter((line) => line.startsWith('worktree '))
          .map((line) => canonicalizeWorktreePath(line.slice('worktree '.length)));
        const workspaceAssignmentsAreIsolated =
          new Set(allWorktreePaths).size === allWorktreePaths.length &&
          allWorktreePaths.every(
            (worktreePath) =>
              fs.existsSync(worktreePath) &&
              registeredWorktreePaths.includes(canonicalizeWorktreePath(worktreePath)),
          );
        startupCheckLog('Git workspace check', {
          assignments: workspaceCheck.assignments.length,
          cleanupDropdownReadyAfterRemoval: workspaceCheck.cleanupDropdownReadyAfterRemoval,
          cleanupFocusDetails: workspaceCheck.cleanupFocusDetails,
          removedFromInterface: workspaceCheck.removedFromInterface,
          worktreePathsExist: allWorktreePaths.map((worktreePath) => fs.existsSync(worktreePath)),
          workspaceAssignmentsAreIsolated,
        });

        if (
          !workspaceCheck.removedFromInterface ||
          !workspaceCheck.cleanupDropdownReadyAfterRemoval ||
          workspaceCheck.assignments.length !== 2 ||
          !workspaceAssignmentsAreIsolated
        ) {
          throw new Error('The startup check did not preserve isolated Git worktrees safely.');
        }

        runStartupCheckGit(
          ['worktree', 'remove', workspaceCheck.removedAssignment.worktreePath],
          startupCheckRepository.repositoryRoot,
        );
        runStartupCheckGit(
          ['branch', '-D', workspaceCheck.removedAssignment.branch],
          startupCheckRepository.repositoryRoot,
        );
        const staleCatalogWasReconciled = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async (predicate, timeoutMs = 3000) => {
            const startedAt = Date.now();

            while (Date.now() - startedAt < timeoutMs) {
              if (predicate()) {
                return true;
              }
              await new Promise((resolve) => setTimeout(resolve, 25));
            }

            return false;
          };
          const stalePath = ${JSON.stringify(workspaceCheck.removedAssignment.worktreePath)};
          document.querySelector('[data-cleanup-worktree]')?.click();
          const opened = await waitFor(
            () => document.querySelector('[data-cleanup-dialog]')?.open === true,
          );
          const options = [
            ...(document.querySelector('[data-cleanup-worktree-select]')?.options ?? []),
          ];
          const staleOptionWasRemoved = !options.some((option) =>
            option.textContent.includes(stalePath),
          );
          const reconciliationWasAnnounced = document
            .querySelector('[data-cleanup-status]')
            ?.textContent.includes('Git confirmed no longer exist');
          document.querySelector('[data-cancel-cleanup]')?.click();
          await waitFor(() => document.querySelector('[data-cleanup-dialog]')?.open === false);
          return opened && staleOptionWasRemoved && reconciliationWasAnnounced;
        })()`);
        startupCheckLog('managed worktree catalog reconciliation', {
          staleCatalogWasReconciled,
        });

        if (!staleCatalogWasReconciled) {
          throw new Error('The startup check left a Git-confirmed stale cleanup record visible.');
        }

        await workspaceService.flush();
        const persistedWorkspace = JSON.parse(
          fs.readFileSync(path.join(workspaceDirectory, WORKSPACE_STATE_FILENAME), 'utf8'),
        );
        const restoredWorkspace = await new WorkspaceStateStore({
          directory: workspaceDirectory,
        }).load();
        const stateMatchesLayout = (state) =>
          state.schemaVersion === 1 &&
          state.revision > 0 &&
          state.terminals.length === layout.terminalIds.length &&
          layout.terminalIds.every((id, index) => {
            const definition = state.terminals[index];
            return (
              definition?.id === id &&
              definition.label === layout.terminalLabels[index] &&
              definition.order === index &&
              definition.workspace.kind === 'git-worktree' &&
              definition.workspace.projectPath === workspaceCheck.assignments[index].worktreePath &&
              definition.workspace.repository.root === startupCheckRepository.repositoryRoot &&
              definition.workspace.repository.branch ===
                `refs/heads/${workspaceCheck.assignments[index].branch}` &&
              definition.workspace.repository.worktree.path ===
                workspaceCheck.assignments[index].worktreePath
            );
          });
        const workspaceWasPersisted =
          stateMatchesLayout(persistedWorkspace) && stateMatchesLayout(restoredWorkspace.state);

        if (!workspaceWasPersisted) {
          throw new Error(
            `The dynamic workspace layout was not persisted and restored correctly: ${JSON.stringify(
              {
                expectedIds: layout.terminalIds,
                expectedLabels: layout.terminalLabels,
                persisted: persistedWorkspace.terminals.map(({ id, label, order, workspace }) => ({
                  id,
                  label,
                  order,
                  workspace,
                })),
                restored: restoredWorkspace.state.terminals.map(
                  ({ id, label, order, workspace }) => ({ id, label, order, workspace }),
                ),
              },
            )}`,
          );
        }

        const lifecycleChildPids = await Promise.all([
          startLifecycleChild(terminalManager, layout.terminalIds[0], 'AGENZA_T010_CHILD_ONE='),
          startLifecycleChild(terminalManager, layout.terminalIds[1], 'AGENZA_T010_CHILD_TWO='),
        ]);
        const terminalPids = [
          ...workspaceCheck.assignments.map(({ sessionPid }) => sessionPid),
          workspaceCheck.removedAssignment.sessionPid,
        ];
        startupCheckLog('lifecycle child pids', lifecycleChildPids);
        window.close();

        const orphanedPids = await waitForProcessesToStop([...lifecycleChildPids, ...terminalPids]);

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
  .then(async () => {
    try {
      app.setAppLogsPath();
    } catch {
      // Electron may already have a logs path configured by the host environment.
    }

    appLogger = createAppLogger({ directory: app.getPath('logs') });
    startupCheckLog('diagnostic log', appLogger.filePath);
    appLogger.info('app.ready', { platform: process.platform, version: app.getVersion() });
    await createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow().catch(handleStartupFailure);
      }
    });
  })
  .catch(handleStartupFailure);

app.on('before-quit', () => {
  appLogger.info('app.quitting');
});

app.on('window-all-closed', () => {
  if (isStartupCheck) {
    return;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
