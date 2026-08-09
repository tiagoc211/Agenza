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
  { mountId: 'terminal-one', label: '01' },
  { mountId: 'terminal-two', label: '02' },
];

const terminalViews = [];

const setActivePane = (activePane) => {
  for (const pane of panes) {
    pane.classList.toggle('is-active', pane === activePane);
  }
};

for (const definition of paneDefinitions) {
  const mount = document.querySelector(`#${definition.mountId}`);
  const pane = mount?.closest('.terminal-pane');

  if (!mount || !pane) {
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
    scrollback: 5000,
    theme: terminalTheme,
  });
  const fitAddon = new FitAddon();

  terminal.loadAddon(fitAddon);
  terminal.open(mount);
  terminal.writeln(`\x1b[1;36mAgenza terminal ${definition.label}\x1b[0m`);
  terminal.writeln('');
  terminal.write('\x1b[90mWaiting for the terminal process layer...\x1b[0m');

  pane.addEventListener('pointerdown', () => {
    setActivePane(pane);
    terminal.focus();
  });
  mount.addEventListener('focusin', () => setActivePane(pane));

  terminalViews.push({ fitAddon, terminal });
}

let resizeFrame;
const fitTerminals = () => {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    for (const { fitAddon } of terminalViews) {
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

if (environment) {
  environment.textContent = window.agenza.platform;
}
