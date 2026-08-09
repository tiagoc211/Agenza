import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const environment = document.querySelector('#environment');
const terminalGrid = document.querySelector('[data-terminal-grid]');
const terminalPaneTemplate = document.querySelector('#terminal-pane-template');
const addTerminalButton = document.querySelector('[data-add-terminal]');
const emptyAddTerminalButton = document.querySelector('[data-empty-add-terminal]');
const emptyWorkspace = document.querySelector('[data-empty-workspace]');
const terminalCount = document.querySelector('[data-terminal-count]:not(.terminal-grid)');

const terminalTheme = {
  background: '#090c12',
  foreground: '#d8dee9',
  cursor: '#68d5ff',
  cursorAccent: '#090c12',
  selectionBackground: '#27425c',
  black: '#171b24',
  brightBlack: '#5e6a7d',
  blue: '#6ea8fe',
  brightBlue: '#92bdff',
  cyan: '#68d5ff',
  brightCyan: '#9ce6ff',
  green: '#73d69c',
  brightGreen: '#99e8ba',
  magenta: '#c69cff',
  brightMagenta: '#dbbdff',
  red: '#ff7a90',
  brightRed: '#ff9bad',
  white: '#d8dee9',
  brightWhite: '#ffffff',
  yellow: '#f4ca78',
  brightYellow: '#ffe09c',
};

const terminalViews = new Map();
let nextLabelNumber = 1;
let resizeFrame;

const getOrderedViews = () => [...terminalViews.values()];

const setActivePane = (activePane) => {
  for (const { pane } of terminalViews.values()) {
    const isActive = pane === activePane;
    pane.classList.toggle('is-active', isActive);
    pane.dataset.activePane = String(isActive);
  }
};

const updateWorkspaceLayout = () => {
  const count = terminalViews.size;

  terminalGrid.dataset.terminalCount = String(count);
  emptyWorkspace.hidden = count !== 0;
  terminalCount.textContent =
    count === 0 ? 'No terminals' : `${count} ${count === 1 ? 'terminal' : 'terminals'}`;
};

const fitTerminals = () => {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    for (const { fitAddon } of terminalViews.values()) {
      fitAddon.fit();
    }
  });
};

const resizeObserver = new ResizeObserver(fitTerminals);
resizeObserver.observe(terminalGrid);

const setSessionState = (view, state, label, description) => {
  view.pane.dataset.sessionState = state;
  view.stateElement.textContent = label;
  view.descriptionElement.textContent = description;
  view.descriptionElement.title = description;
  view.restartButton.classList.toggle(
    'is-recovery-action',
    state === 'exited' || state === 'error',
  );
};

const formatUserFacingError = (error, fallback = 'An unexpected error occurred.') => {
  const message = typeof error?.message === 'string' ? error.message : fallback;
  const printableMessage = [...message]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 32 && (codePoint < 127 || codePoint > 159) ? character : ' ';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return (printableMessage || fallback).slice(0, 500);
};

const showSessionFailure = (view, { description, error, heading, recovery }) => {
  view.terminal.writeln(`\r\n\x1b[31m${heading}\x1b[0m`);
  view.terminal.writeln(`\x1b[31m${formatUserFacingError(error)}\x1b[0m`);
  view.terminal.writeln(`\x1b[90m${recovery}\x1b[0m`);
  setSessionState(view, 'error', 'Error', description);
};

const setControlsBusy = (view, isBusy) => {
  view.isBusy = isBusy;
  view.clearButton.disabled = isBusy;
  view.projectButton.disabled = isBusy;
  view.pasteButton.disabled = isBusy || !view.isConnected;
  view.restartButton.disabled = isBusy || !view.projectFolder;
  view.removeButton.disabled = isBusy;
};

const copyTerminalSelection = async (view) => {
  const selectedText = view.terminal.getSelection();

  if (selectedText) {
    await window.agenza.clipboard.writeText(selectedText);
  }
};

const pasteIntoTerminal = async (view) => {
  if (!view.isConnected) {
    return;
  }

  const text = await window.agenza.clipboard.readText();

  if (text) {
    view.terminal.paste(text);
  }

  setActivePane(view.pane);
  view.terminal.focus();
};

const runClipboardAction = (action) => {
  action().catch(() => {
    // Clipboard errors stay local to the requested action and never affect another PTY.
  });
};

const launchSession = async (view, { restart, failureMessage }) => {
  setControlsBusy(view, true);
  view.isRestarting = restart;
  view.isConnected = false;
  view.terminal.options.disableStdin = true;
  view.terminal.reset();
  view.terminal.writeln(`\x1b[1;36mAgenza · ${view.label}\x1b[0m`);
  view.terminal.writeln(`\x1b[90mProject: ${view.projectFolder}\x1b[0m`);
  setSessionState(
    view,
    restart ? 'restarting' : 'starting',
    restart ? 'Restarting' : 'Starting',
    view.projectFolder,
  );

  try {
    const snapshot = restart
      ? await window.agenza.terminal.restart(view.id)
      : await window.agenza.terminal.start(view.id);

    if (!snapshot.isRunning) {
      throw new Error('The Codex process did not stay running.');
    }

    view.isConnected = true;
    view.terminal.options.disableStdin = false;
    setSessionState(view, 'connected', 'Connected', view.projectFolder);
    view.fitAddon.fit();
    window.agenza.terminal.resize(view.id, view.terminal.cols, view.terminal.rows);
    setActivePane(view.pane);
    view.terminal.focus();
  } catch (error) {
    view.isConnected = false;
    view.terminal.options.disableStdin = true;
    showSessionFailure(view, {
      description: 'Codex could not start - check setup and retry',
      error,
      heading: `${failureMessage}.`,
      recovery: 'Check that Codex works in a normal terminal, then restart Agenza and retry.',
    });
  } finally {
    view.isRestarting = false;
    setControlsBusy(view, false);
  }
};

const chooseProjectFolder = async (view) => {
  if (view.isBusy) {
    return;
  }

  setControlsBusy(view, true);
  view.projectButton.textContent = 'Selecting...';

  try {
    const result = await window.agenza.project.selectFolder(view.id);

    if (result.canceled) {
      return;
    }

    const isRestart = view.isConnected;
    view.projectFolder = result.path;
    await launchSession(view, {
      restart: isRestart,
      failureMessage: 'Unable to use project folder',
    });
  } catch (error) {
    view.isConnected = false;
    view.terminal.options.disableStdin = true;
    showSessionFailure(view, {
      description: 'Project folder unavailable - choose another folder',
      error,
      heading: 'Unable to use project folder.',
      recovery: 'Choose a readable and writable project folder, then try again.',
    });
  } finally {
    setControlsBusy(view, false);
    view.projectButton.textContent = view.projectFolder ? 'Change folder' : 'Choose folder';
  }
};

const removeTerminalView = async (view) => {
  if (view.isBusy) {
    return;
  }

  const confirmed = window.confirm(
    `Remove ${view.label}? This stops only its Codex process. Project files are not deleted.`,
  );

  if (!confirmed) {
    return;
  }

  const viewsBeforeRemoval = getOrderedViews();
  const removedIndex = viewsBeforeRemoval.indexOf(view);
  const wasActive = view.pane.classList.contains('is-active');
  view.isRemoving = true;
  setControlsBusy(view, true);
  setSessionState(view, 'stopping', 'Stopping', 'Stopping this terminal process');

  try {
    await window.agenza.terminal.remove(view.id);
  } catch (error) {
    view.isRemoving = false;
    showSessionFailure(view, {
      description: 'Terminal could not be removed - retry or close Agenza',
      error,
      heading: 'Unable to remove terminal.',
      recovery: 'Retry removal. Closing Agenza will also stop every terminal process.',
    });
    setControlsBusy(view, false);
    return;
  }

  terminalViews.delete(view.id);
  view.terminal.dispose();
  view.pane.remove();
  updateWorkspaceLayout();

  const remainingViews = getOrderedViews();

  if (wasActive && remainingViews.length > 0) {
    const nextView = remainingViews[Math.min(removedIndex, remainingViews.length - 1)];
    setActivePane(nextView.pane);
    nextView.terminal.focus();
  } else if (remainingViews.length === 0) {
    setActivePane(null);
    addTerminalButton.focus();
  }

  fitTerminals();
};

const configureTerminalShortcuts = (view) => {
  view.terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      return true;
    }

    const key = event.key.toLowerCase();
    const commandKey = event.ctrlKey || event.metaKey;
    const copyShortcut =
      (commandKey && key === 'c' && (event.shiftKey || view.terminal.hasSelection())) ||
      (event.ctrlKey && key === 'insert');
    const pasteShortcut =
      (commandKey && key === 'v') || (event.shiftKey && !commandKey && key === 'insert');

    if (copyShortcut) {
      event.preventDefault();
      event.stopPropagation();
      runClipboardAction(() => copyTerminalSelection(view));
      return false;
    }

    if (pasteShortcut) {
      event.preventDefault();
      event.stopPropagation();
      runClipboardAction(() => pasteIntoTerminal(view));
      return false;
    }

    return true;
  });
};

const createTerminalView = (snapshot, { activate = true } = {}) => {
  if (typeof snapshot?.id !== 'string' || terminalViews.has(snapshot.id)) {
    throw new Error('Agenza received an invalid or duplicate terminal session.');
  }

  const labelNumber = nextLabelNumber++;
  const label = `Terminal ${labelNumber}`;
  const pane = terminalPaneTemplate.content.firstElementChild.cloneNode(true);
  const mount = pane.querySelector('[data-terminal-mount]');
  const title = pane.querySelector('[data-terminal-title]');
  const titleId = `terminal-title-${snapshot.id}`;
  const projectButton = pane.querySelector('[data-project-button]');
  const copyButton = pane.querySelector('[data-copy-button]');
  const pasteButton = pane.querySelector('[data-paste-button]');
  const clearButton = pane.querySelector('[data-clear-button]');
  const restartButton = pane.querySelector('[data-restart-button]');
  const removeButton = pane.querySelector('[data-remove-button]');

  pane.dataset.paneId = snapshot.id;
  pane.dataset.activePane = 'false';
  pane.setAttribute('aria-labelledby', titleId);
  title.id = titleId;
  title.textContent = label;
  pane.querySelector('[data-terminal-number]').textContent = String(labelNumber).padStart(2, '0');
  mount.id = `terminal-mount-${snapshot.id}`;
  mount.setAttribute('aria-label', `${label} Codex console`);
  copyButton.setAttribute('aria-label', `Copy selected text from ${label}`);
  pasteButton.setAttribute('aria-label', `Paste text into ${label}`);
  clearButton.setAttribute('aria-label', `Clear ${label}`);
  restartButton.setAttribute('aria-label', `Restart ${label}`);
  removeButton.setAttribute('aria-label', `Remove ${label}`);
  terminalGrid.append(pane);

  const terminal = new Terminal({
    allowTransparency: false,
    convertEol: true,
    cursorBlink: true,
    disableStdin: true,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.25,
    screenReaderMode: true,
    scrollback: 5000,
    theme: terminalTheme,
  });
  const fitAddon = new FitAddon();

  terminal.loadAddon(fitAddon);
  terminal.open(mount);
  terminal.writeln(`\x1b[1;36mAgenza · ${label}\x1b[0m`);
  terminal.writeln('');
  terminal.writeln('\x1b[90mChoose a project folder to start Codex.\x1b[0m');

  const view = {
    clearButton,
    copyButton,
    descriptionElement: pane.querySelector('[data-terminal-description]'),
    fitAddon,
    id: snapshot.id,
    isBusy: false,
    isConnected: snapshot.isRunning,
    isRemoving: false,
    isRestarting: false,
    label,
    pane,
    pasteButton,
    projectButton,
    projectFolder: null,
    removeButton,
    restartButton,
    stateElement: pane.querySelector('[data-terminal-state]'),
    terminal,
  };

  terminalViews.set(view.id, view);

  pane.addEventListener('pointerdown', (event) => {
    setActivePane(pane);

    if (!event.target.closest?.('button') && !event.target.closest?.('.xterm')) {
      terminal.focus();
    }
  });
  pane.addEventListener('focusin', () => setActivePane(pane));
  terminal.onData((data) => {
    if (view.isConnected) {
      window.agenza.terminal.write(view.id, data);
    }
  });
  terminal.onResize(({ cols, rows }) => {
    if (view.isConnected) {
      window.agenza.terminal.resize(view.id, cols, rows);
    }
  });
  terminal.onSelectionChange(() => {
    view.copyButton.disabled = !terminal.hasSelection();
  });

  projectButton.addEventListener('click', () => chooseProjectFolder(view));
  copyButton.addEventListener('click', () => {
    runClipboardAction(() => copyTerminalSelection(view));
  });
  pasteButton.addEventListener('click', () => {
    runClipboardAction(() => pasteIntoTerminal(view));
  });
  clearButton.addEventListener('click', () => {
    if (view.isConnected) {
      window.agenza.terminal.write(view.id, '\x0c');
    } else {
      view.terminal.reset();
    }

    setActivePane(view.pane);
    view.terminal.focus();
  });
  restartButton.addEventListener('click', () => {
    if (view.projectFolder && !view.isBusy) {
      launchSession(view, {
        restart: true,
        failureMessage: 'Unable to restart Codex',
      });
    }
  });
  removeButton.addEventListener('click', () => removeTerminalView(view));
  configureTerminalShortcuts(view);

  updateWorkspaceLayout();
  fitTerminals();

  if (activate) {
    setActivePane(pane);
    terminal.focus();
  }

  return view;
};

const addTerminal = async () => {
  addTerminalButton.disabled = true;
  emptyAddTerminalButton.disabled = true;

  try {
    const snapshot = await window.agenza.terminal.create();
    createTerminalView(snapshot);
    addTerminalButton.title = '';
  } catch (error) {
    addTerminalButton.title = formatUserFacingError(error, 'Unable to add a terminal.');
    terminalCount.textContent = 'Unable to add terminal';
  } finally {
    addTerminalButton.disabled = false;
    emptyAddTerminalButton.disabled = false;
  }
};

const disposeDataSubscription = window.agenza.terminal.onData(({ id, data }) => {
  terminalViews.get(id)?.terminal.write(data);
});

const disposeExitSubscription = window.agenza.terminal.onExit(({ id, exitCode }) => {
  const view = terminalViews.get(id);

  if (!view || view.isRemoving) {
    return;
  }

  view.isConnected = false;
  view.terminal.options.disableStdin = true;

  if (view.isRestarting) {
    return;
  }

  view.terminal.writeln(`\r\n\x1b[31mCodex exited unexpectedly with code ${exitCode}.\x1b[0m`);
  view.terminal.writeln('\x1b[90mUse Restart above to launch this session again.\x1b[0m');
  setSessionState(view, 'exited', 'Exited', 'Codex stopped — restart available');
  view.restartButton.disabled = !view.projectFolder || view.isBusy;
});

const handleTerminalFocusShortcut = (event) => {
  if (event.key !== 'F6' || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const views = getOrderedViews();

  if (views.length < 2) {
    return;
  }

  event.preventDefault();
  const activeIndex = views.findIndex(({ pane }) => pane.classList.contains('is-active'));
  const direction = event.shiftKey ? -1 : 1;
  const startingIndex = activeIndex === -1 ? (event.shiftKey ? 0 : views.length - 1) : activeIndex;
  const nextIndex = (startingIndex + direction + views.length) % views.length;
  const nextView = views[nextIndex];

  setActivePane(nextView.pane);
  nextView.terminal.focus();
};

document.addEventListener('keydown', handleTerminalFocusShortcut);
addTerminalButton.addEventListener('click', () => addTerminal());
emptyAddTerminalButton.addEventListener('click', () => addTerminal());

const initializeWorkspace = async () => {
  try {
    const snapshots = await window.agenza.terminal.list();

    for (const snapshot of snapshots) {
      createTerminalView(snapshot, { activate: false });
    }

    const firstView = getOrderedViews()[0];

    if (firstView) {
      setActivePane(firstView.pane);
    }
  } catch (error) {
    emptyWorkspace.querySelector('p').textContent = formatUserFacingError(
      error,
      'Agenza could not load its terminals. Add a new terminal to retry.',
    );
  } finally {
    terminalGrid.dataset.workspaceReady = 'true';
    updateWorkspaceLayout();
    fitTerminals();
  }
};

initializeWorkspace();

window.addEventListener('beforeunload', () => {
  document.removeEventListener('keydown', handleTerminalFocusShortcut);
  resizeObserver.disconnect();
  disposeDataSubscription();
  disposeExitSubscription();

  for (const { terminal } of terminalViews.values()) {
    terminal.dispose();
  }
});

if (environment) {
  environment.textContent = window.agenza.platform;
}
