const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const scope = readFileSync('docs/scope-0.3.0.md', 'utf8');
const model = readFileSync('docs/orchestration-model-0.3.0.md', 'utf8');

test('defines the source-neutral orchestration workflow and explicit entity boundaries', () => {
  assert.match(scope, /startOrchestration\(\{ goal, options, projectTerminalId \}\)/);
  assert.match(model, /ProjectWorkspaceContext/);
  assert.match(model, /AgentRuntime/);
  assert.match(model, /Terminal.*interactive process\/view resource/);
  assert.match(model, /CodexAppServerProvider/);
});

test('documents limits, dependencies, review readiness, and deferred integration', () => {
  assert.match(scope, /Maximum worker agents.*Range 1-4/s);
  assert.match(scope, /Propagating dependency commits/);
  assert.match(scope, /No automatic merge, rebase, or cherry-pick is performed/);
  assert.match(model, /dependency\s+cycles/);
  assert.match(model, /ready-for-review/);
});

test('preserves main-process authority, privacy, isolation, and process cleanup', () => {
  assert.match(scope, /Renderer payloads never contain an executable/);
  assert.match(scope, /One canonical Git worktree path cannot be assigned to two/);
  assert.match(scope, /Logs contain event names/);
  assert.match(
    scope,
    /Provider process trees join the existing window resource-disposal lifecycle/,
  );
});
