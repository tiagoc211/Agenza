const assert = require('node:assert/strict');
const { mkdtemp, readFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  OrchestrationStateStore,
  createDefaultOrchestrationState,
  recoverInterruptedState,
} = require('../src/orchestration/orchestration-state');

const runningState = () => ({
  schemaVersion: 1,
  revision: 1,
  orchestrations: [
    {
      id: 'orchestration-00000000-0000-4000-8000-000000000001',
      goal: 'Test goal',
      status: 'running',
      project: {},
      options: {},
      orchestratorAgentId: 'agent-00000000-0000-4000-8000-000000000001',
      tasks: [
        {
          id: 'task-00000000-0000-4000-8000-000000000001',
          status: 'working',
          dependencies: [],
        },
      ],
      agents: [
        {
          id: 'agent-00000000-0000-4000-8000-000000000001',
          status: 'working',
          taskId: null,
        },
      ],
      createdAt: '2026-08-21T10:00:00.000Z',
      startedAt: '2026-08-21T10:00:00.000Z',
      completedAt: null,
    },
  ],
});

test('persists orchestration state atomically and keeps a previous backup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agenza-orchestration-state-'));
  const store = new OrchestrationStateStore({ directory });
  const initial = createDefaultOrchestrationState();
  await store.save(initial);
  const next = runningState();
  await store.save(next);

  assert.deepEqual((await store.load()).state, next);
  assert.deepEqual(JSON.parse(await readFile(store.backupPath, 'utf8')), initial);
});

test('recovers in-flight orchestrations as stopped without deleting resource metadata', () => {
  const original = runningState();
  const recovered = recoverInterruptedState(original, () => '2026-08-21T11:00:00.000Z');

  assert.equal(recovered.changed, true);
  assert.equal(recovered.state.orchestrations[0].status, 'stopped');
  assert.equal(recovered.state.orchestrations[0].agents[0].status, 'stopped');
  assert.equal(recovered.state.orchestrations[0].tasks[0].status, 'stopped');
  assert.equal(original.orchestrations[0].status, 'running');
});
