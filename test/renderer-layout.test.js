const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const html = readFileSync('src/renderer/index.html', 'utf8');
const renderer = readFileSync('src/renderer/index.js', 'utf8');
const styles = readFileSync('src/renderer/styles.css', 'utf8');

test('defines two independent terminal panes', () => {
  const mounts = html.match(/class="terminal-mount"/g) ?? [];

  assert.equal(mounts.length, 2);
  assert.match(html, /data-pane-id="terminal-one"/);
  assert.match(html, /data-pane-id="terminal-two"/);
  assert.match(renderer, /new Terminal/);
  assert.match(renderer, /new FitAddon/);
});

test('keeps panes responsive and exposes an active state', () => {
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.terminal-pane\.is-active/);
  assert.match(renderer, /new ResizeObserver\(fitTerminals\)/);
  assert.match(renderer, /classList\.toggle\('is-active'/);
});

test('connects each xterm view to its matching PTY session', () => {
  assert.match(renderer, /terminal\.onData/);
  assert.match(renderer, /terminal\.onResize/);
  assert.match(renderer, /window\.agenza\.terminal\.write\(view\.id, data\)/);
  assert.match(renderer, /terminalViews\.get\(id\)\?\.terminal\.write\(data\)/);
  assert.match(renderer, /window\.agenza\.terminal\.resize\(view\.id/);
  assert.match(renderer, /Choose a project folder to start Codex/);
});

test('selects and displays a project folder before starting sessions', () => {
  assert.equal((html.match(/data-project-button/g) ?? []).length, 2);
  assert.match(renderer, /window\.agenza\.project\.selectFolder\(view\.id\)/);
  assert.match(renderer, /window\.agenza\.terminal\.start\(view\.id\)/);
  assert.match(renderer, /window\.agenza\.terminal\.restart\(view\.id\)/);
  assert.match(renderer, /setSessionState\(view, 'connected', 'Connected', result\.path\)/);
});
