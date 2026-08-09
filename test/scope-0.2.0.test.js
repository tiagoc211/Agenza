const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const scope = readFileSync('docs/scope-0.2.0.md', 'utf8');

test('documents the dynamic terminal and Git workspace workflows', () => {
  assert.match(scope, /### Add a terminal/);
  assert.match(scope, /### Remove a terminal/);
  assert.match(scope, /### Assign or change a Git workspace/);
  assert.match(scope, /### Clean up an Agenza-created worktree/);
  assert.match(scope, /ordinary project folder without Git/);
  assert.match(scope, /different worktrees of the same repository/);
});

test('separates terminal removal, worktree cleanup, and branch deletion', () => {
  assert.match(
    scope,
    /No single control may combine terminal removal, worktree cleanup, or branch deletion/,
  );
  assert.match(
    scope,
    /\| Remove terminal\s+\|\s+Terminated\s+\|\s+Removed\s+\|\s+Preserved\s+\|\s+Preserved\s+\|/,
  );
  assert.match(scope, /Branches are never deleted automatically/);
  assert.match(scope, /does not use forced worktree removal/);
});

test('defines the excluded Git and product behavior for 0.2.0', () => {
  for (const excludedOperation of [
    'Automatic merge',
    'rebase',
    'push',
    'pull',
    'Branch deletion',
    'task delegation between Codex agents',
    'CLI tools other than Codex',
  ]) {
    assert.match(scope, new RegExp(excludedOperation));
  }
});
