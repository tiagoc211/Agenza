const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const model = readFileSync('docs/workspace-model-0.2.0.md', 'utf8');
const schema = JSON.parse(readFileSync('docs/workspace-state-schema-v1.json', 'utf8'));

const collectPropertyNames = (value, names = new Set()) => {
  if (!value || typeof value !== 'object') {
    return names;
  }

  if (value.properties) {
    for (const name of Object.keys(value.properties)) {
      names.add(name);
    }
  }

  for (const child of Object.values(value)) {
    collectPropertyNames(child, names);
  }

  return names;
};

test('defines stable terminal identity and the required persisted workspace fields', () => {
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.deepEqual(schema.required, ['schemaVersion', 'revision', 'activeTerminalId', 'terminals']);
  assert.deepEqual(schema.$defs.terminalDefinition.required, [
    'id',
    'label',
    'order',
    'createdAt',
    'updatedAt',
    'workspace',
  ]);
  assert.deepEqual(schema.$defs.repositoryAssignment.required, ['root', 'branch', 'worktree']);
  assert.match(schema.$defs.terminalId.pattern, /terminal-/);
  assert.match(model, /ID is the only terminal identity used by IPC and process routing/);
});

test('keeps terminal, workspace, and Git operation lifecycles separate', () => {
  assert.match(model, /## Terminal process lifecycle/);
  assert.match(model, /## Git workspace lifecycle/);
  assert.match(model, /## Confirmed Git operation lifecycle/);
  assert.match(model, /workspace operation cannot silently move a terminal through these states/);
  assert.match(model, /Persisted terminal state changes only after the operation succeeds/);
});

test('records explicit worktree ownership without branch ownership', () => {
  const ownershipKinds = [
    schema.$defs.externalOwnership.properties.kind.const,
    schema.$defs.agenzaOwnership.properties.kind.const,
  ];

  assert.deepEqual(ownershipKinds, ['external', 'agenza']);
  assert.equal(schema.$defs.externalOwnership.properties.creationId.type, 'null');
  assert.match(schema.$defs.agenzaOwnership.properties.creationId.pattern, /worktree-/);
  assert.equal(schema.properties.managedWorktrees.items.$ref, '#/$defs/managedWorktree');
  assert.deepEqual(schema.$defs.managedWorktree.required, [
    'creationId',
    'repositoryRoot',
    'branchRef',
    'path',
  ]);
  assert.match(model, /managed-worktree catalog/);
  assert.match(model, /removes the catalog record; it never removes the branch/);
  assert.match(model, /Branches have no ownership flag/);
});

test('excludes terminal content, runtime processes, environment, and secrets from persistence', () => {
  const persistedPropertyNames = collectPropertyNames(schema);

  for (const forbiddenProperty of [
    'pid',
    'input',
    'output',
    'scrollback',
    'clipboard',
    'environment',
    'token',
    'credentials',
  ]) {
    assert.equal(persistedPropertyNames.has(forbiddenProperty), false);
  }

  assert.match(model, /## Data that is never persisted/);
  assert.match(model, /unknown higher `schemaVersion`/);
  assert.match(model, /atomic replacement/);
});
