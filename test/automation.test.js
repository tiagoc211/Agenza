const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const allTestsRunner = readFileSync('test/run-all-tests.js', 'utf8');
const main = readFileSync('src/main.js', 'utf8');
const smokeRunner = readFileSync('test/run-smoke-test.js', 'utf8');

test('provides separate unit, smoke, and complete automated test commands', () => {
  assert.equal(packageJson.scripts.test, 'node test/run-tests.js');
  assert.equal(packageJson.scripts['test:smoke'], 'node test/run-smoke-test.js');
  assert.equal(packageJson.scripts['test:all'], 'node test/run-all-tests.js');
  assert.equal(packageJson.scripts['test:release'], 'node test/validate-release-artifacts.js');
  assert.match(allTestsRunner, /run-tests\.js/);
  assert.match(allTestsRunner, /'run', 'build'/);
  assert.match(allTestsRunner, /run-smoke-test\.js/);
});

test('runs the packaged dynamic terminal and Git workspace startup check with a bounded timeout', () => {
  assert.match(smokeRunner, /Agenza-win32-x64/);
  assert.match(smokeRunner, /--startup-check/);
  assert.match(smokeRunner, /SMOKE_TIMEOUT_MS = 60000/);
  assert.match(smokeRunner, /killProcessTree\(child\.pid\)/);
  assert.match(smokeRunner, /temporaryWorkspacePath/);
  assert.match(smokeRunner, /removeTemporaryWorkspace/);
  assert.match(main, /createStartupCheckRepository/);
  assert.match(main, /create-new-branch-worktree/);
  assert.match(main, /workspaceAssignmentsAreIsolated/);
  assert.match(main, /removedFromInterface/);
  assert.match(main, /data-confirm-terminal-removal/);
});

test('provides a repeatable manual check for missing Codex', () => {
  assert.match(main, /--missing-codex-check/);
  assert.match(main, /Codex CLI was not found on PATH/);
});
