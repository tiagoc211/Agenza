import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const environment = document.querySelector('#environment');
const panes = [...document.querySelectorAll('.terminal-pane')];

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

const paneDefinitions = [
  { id: 'terminal-one', label: '01' },
  { id: 'terminal-two', label: '02' },
];

const terminalViews = new Map();

const setActivePane = (activePane) => {
  for (const pane of panes) {
    const isActive = pane === activePane;
    pane.classList.toggle('is-active', isActive);
    pane.dataset.activePane = String(isActive);
  }
};

for (const definition of paneDefinitions) {
  const mount = document.querySelector(`#${definition.id}`);
  const pane = mount?.closest('.terminal-pane');
  const projectButton = pane?.querySelector('[data-project-button]');
  const clearButton = pane?.querySelector('[data-clear-button]');
  const restartButton = pane?.querySelector('[data-restart-button]');

  if (!mount || !pane || !projectButton || !clearButton || !restartButton) {
    continue;
  }

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
  terminal.writeln(`\x1b[1;36mAgenza terminal ${definition.label}\x1b[0m`);
  terminal.writeln('');
  terminal.writeln('\x1b[90mChoose a project folder to start Codex.\x1b[0m');

  pane.addEventListener('pointerdown', (event) => {
    setActivePane(pane);

    if (!event.target.closest?.('button')) {
      terminal.focus();
    }
  });
  pane.addEventListener('focusin', () => setActivePane(pane));

  const view = {
    clearButton,
    id: definition.id,
    fitAddon,
    isBusy: false,
    isRestarting: false,
    pane,
    projectButton,
    projectFolder: null,
    restartButton,
    terminal,
    isConnected: false,
  };

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

  terminalViews.set(definition.id, view);
}

const setSessionState = (view, state, label, description) => {
  view.pane.dataset.sessionState = state;
  view.pane.querySelector('[data-terminal-state]').textContent = label;
  const descriptionElement = view.pane.querySelector('[data-terminal-description]');
  descriptionElement.textContent = description;
  descriptionElement.title = description;
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
  view.projectButton.disabled = isBusy;
  view.restartButton.disabled = isBusy || !view.projectFolder;
};

const disposeDataSubscription = window.agenza.terminal.onData(({ id, data }) => {
  terminalViews.get(id)?.terminal.write(data);
});

const disposeExitSubscription = window.agenza.terminal.onExit(({ id, exitCode }) => {
  const view = terminalViews.get(id);

  if (!view) {
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

let resizeFrame;
const fitTerminals = () => {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    for (const { fitAddon } of terminalViews.values()) {
      fitAddon.fit();
    }
  });
};

const resizeObserver = new ResizeObserver(fitTerminals);
const terminalGrid = document.querySelector('.terminal-grid');

if (terminalGrid) {
  resizeObserver.observe(terminalGrid);
}

fitTerminals();

const launchSession = async (view, { restart, failureMessage }) => {
  setControlsBusy(view, true);
  view.isRestarting = restart;
  view.isConnected = false;
  view.terminal.options.disableStdin = true;
  view.terminal.reset();
  view.terminal.writeln(`\x1b[1;36mAgenza ${view.id}\x1b[0m`);
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
      recovery: 'Check the agenza Conda environment and Codex installation, then use Restart.',
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

for (const view of terminalViews.values()) {
  view.projectButton.addEventListener('click', () => chooseProjectFolder(view));
  view.clearButton.addEventListener('click', () => {
    if (view.isConnected) {
      window.agenza.terminal.write(view.id, '\x0c');
    } else {
      view.terminal.reset();
    }

    setActivePane(view.pane);
    view.terminal.focus();
  });
  view.restartButton.addEventListener('click', () => {
    if (!view.projectFolder || view.isBusy) {
      return;
    }

    launchSession(view, {
      restart: true,
      failureMessage: 'Unable to restart Codex',
    });
  });
}

const handleTerminalFocusShortcut = (event) => {
  if (event.key !== 'F6' || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const views = [...terminalViews.values()];

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

window.addEventListener('beforeunload', () => {
  document.removeEventListener('keydown', handleTerminalFocusShortcut);
  resizeObserver.disconnect();
  disposeDataSubscription();
  disposeExitSubscription();
});

if (environment) {
  environment.textContent = window.agenza.platform;
}
