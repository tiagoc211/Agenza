const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const html = readFileSync('src/renderer/index.html', 'utf8');
const renderer = readFileSync('src/renderer/index.js', 'utf8');
const styles = readFileSync('src/renderer/styles.css', 'utf8');

test('builds terminal panes from one reusable template instead of fixed pane ids', () => {
  assert.equal((html.match(/class="terminal-mount"/g) ?? []).length, 1);
  assert.equal((html.match(/class="terminal-pane"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /terminal-one|terminal-two/);
  assert.match(html, /id="terminal-pane-template"/);
  assert.match(renderer, /terminalPaneTemplate\.content\.firstElementChild\.cloneNode\(true\)/);
  assert.match(renderer, /pane\.dataset\.paneId = snapshot\.id/);
  assert.match(renderer, /new Terminal/);
  assert.match(renderer, /new FitAddon/);
});

test('adds and removes dynamic terminal sessions through the narrow bridge', () => {
  assert.match(html, /data-add-terminal/);
  assert.match(html, /data-empty-add-terminal/);
  assert.match(html, /data-remove-button/);
  assert.match(renderer, /window\.agenza\.terminal\.list\(\)/);
  assert.match(renderer, /window\.agenza\.terminal\.create\(\)/);
  assert.match(renderer, /window\.agenza\.terminal\.remove\(view\.id\)/);
  assert.match(renderer, /terminalViews\.delete\(view\.id\)/);
  assert.match(renderer, /view\.terminal\.dispose\(\)/);
  assert.match(renderer, /Project files are not deleted/);
});

test('keeps zero, one, two, and several terminal layouts usable', () => {
  assert.match(html, /data-empty-workspace/);
  assert.match(renderer, /emptyWorkspace\.hidden = count !== 0/);
  assert.match(renderer, /terminalGrid\.dataset\.terminalCount = String\(count\)/);
  assert.match(styles, /repeat\(auto-fit, minmax\(min\(30rem, 100%\), 1fr\)\)/);
  assert.match(styles, /data-terminal-count='1'/);
  assert.match(styles, /data-terminal-count='2'/);
  assert.match(styles, /overflow: auto/);
  assert.match(renderer, /new ResizeObserver\(fitTerminals\)/);
});

test('gives every pane independent controls, process state, and a stable label', () => {
  for (const control of [
    'data-project-button',
    'data-copy-button',
    'data-paste-button',
    'data-clear-button',
    'data-restart-button',
    'data-remove-button',
  ]) {
    assert.equal((html.match(new RegExp(control, 'g')) ?? []).length, 1);
  }

  assert.match(renderer, /const label = `Terminal \$\{labelNumber\}`/);
  assert.match(renderer, /label,/);
  assert.match(renderer, /setSessionState\(view, 'connected', 'Connected', view\.projectFolder\)/);
  assert.match(renderer, /terminalViews\.get\(id\)\?\.terminal\.write\(data\)/);
  assert.match(renderer, /window\.agenza\.terminal\.resize\(view\.id/);
});

test('selects and displays an independent project folder before starting each session', () => {
  assert.match(renderer, /window\.agenza\.project\.selectFolder\(view\.id\)/);
  assert.match(renderer, /window\.agenza\.terminal\.start\(view\.id\)/);
  assert.match(renderer, /window\.agenza\.terminal\.restart\(view\.id\)/);
  assert.match(renderer, /view\.projectFolder = result\.path/);
  assert.match(renderer, /Choose a project folder to start Codex/);
});

test('preserves independent clear, restart, and terminal-local recovery behavior', () => {
  assert.match(renderer, /window\.agenza\.terminal\.write\(view\.id, '\\x0c'\)/);
  assert.match(renderer, /view\.terminal\.reset\(\)/);
  assert.match(renderer, /Use Restart above to launch this session again/);
  assert.match(renderer, /setSessionState\(view, 'exited', 'Exited'/);
  assert.match(renderer, /const formatUserFacingError/);
  assert.match(renderer, /\.slice\(0, 500\)/);
  assert.match(renderer, /Check that Codex works in a normal terminal/);
  assert.match(renderer, /Choose a readable and writable project folder/);
});

test('tracks one active pane and cycles focus across the current dynamic order', () => {
  assert.match(html, /aria-keyshortcuts="F6 Shift\+F6"/);
  assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 2);
  assert.match(renderer, /getOrderedViews\(\)/);
  assert.match(renderer, /classList\.toggle\('is-active'/);
  assert.match(renderer, /event\.key !== 'F6'/);
  assert.match(renderer, /event\.shiftKey \? -1 : 1/);
  assert.match(renderer, /nextView\.terminal\.focus\(\)/);
  assert.match(styles, /\.terminal-pane:focus-within/);
  assert.match(styles, /\.pane-action-button:focus-visible/);
});

test('supports mouse selection and terminal-safe clipboard shortcuts in every new pane', () => {
  assert.match(renderer, /terminal\.onSelectionChange/);
  assert.match(renderer, /view\.terminal\.getSelection\(\)/);
  assert.match(renderer, /window\.agenza\.clipboard\.writeText\(selectedText\)/);
  assert.match(renderer, /window\.agenza\.clipboard\.readText\(\)/);
  assert.match(renderer, /view\.terminal\.paste\(text\)/);
  assert.match(renderer, /attachCustomKeyEventHandler/);
  assert.match(renderer, /event\.shiftKey \|\| view\.terminal\.hasSelection\(\)/);
  assert.equal((renderer.match(/event\.preventDefault\(\)/g) ?? []).length, 3);
  assert.equal((renderer.match(/event\.stopPropagation\(\)/g) ?? []).length, 2);
});
