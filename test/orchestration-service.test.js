/* global fetch */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ORCHESTRATOR_BOOTSTRAP,
  OrchestrationService,
} = require('../src/orchestration/orchestration-service');

const FIRST_ID = 'terminal-00000000-0000-4000-8000-000000000001';
const SECOND_ID = 'terminal-00000000-0000-4000-8000-000000000002';

const createHarness = () => {
  const writes = [];
  let nextId = 3;
  let sessions = [
    {
      id: FIRST_ID,
      isRunning: true,
      label: 'Coordinator',
      order: 0,
      workspace: { kind: 'folder' },
    },
    {
      id: SECOND_ID,
      isRunning: false,
      label: 'Worker',
      order: 1,
      workspace: { kind: 'git-worktree' },
    },
  ];
  const manager = {
    getSnapshot: (id) => sessions.find((session) => session.id === id),
    has: (id) => sessions.some((session) => session.id === id),
    write: (id, data) => writes.push({ data, id }),
  };
  const workspaceService = {
    create: () => {
      const snapshot = {
        id: `terminal-00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
        isRunning: false,
        label: `Terminal ${nextId}`,
        order: sessions.length,
        workspace: { kind: 'unassigned' },
      };
      sessions.push(snapshot);
      return snapshot;
    },
    getCatalog: () => ({ sessions }),
    remove: async (id) => {
      sessions = sessions.filter((session) => session.id !== id);
      return { id, removed: true };
    },
  };
  const service = new OrchestrationService({
    now: () => '2026-08-20T12:00:00.000Z',
    terminalManager: manager,
    tokenFactory: () => 'test-token',
    workspaceService,
  });

  return { manager, service, sessions: () => sessions, writes, workspaceService };
};

test('selects a live orchestrator and teaches its connected Codex session the CLI protocol', () => {
  const { service, writes } = createHarness();
  const state = service.setOrchestrator(FIRST_ID);

  assert.equal(state.orchestratorId, FIRST_ID);
  assert.equal(state.agents[0].isOrchestrator, true);
  assert.deepEqual(writes, [{ data: `${ORCHESTRATOR_BOOTSTRAP}\r`, id: FIRST_ID }]);
  assert.throws(() => service.setOrchestrator('terminal-missing'), /Unknown orchestration agent/);
});

test('allows only the selected agent to create and remove instances through the agent API', async () => {
  const { service, sessions } = createHarness();
  service.setOrchestrator(FIRST_ID);

  await assert.rejects(
    service.createAgent({ requestedBy: SECOND_ID }),
    /Only the selected orchestrator/,
  );
  const created = await service.createAgent({ requestedBy: FIRST_ID });
  assert.equal(created.snapshot.workspace.kind, 'unassigned');
  assert.equal(sessions().length, 3);

  await assert.rejects(
    service.removeAgent(FIRST_ID, { requestedBy: FIRST_ID }),
    /cannot remove its own terminal/,
  );
  await service.removeAgent(created.snapshot.id, { requestedBy: FIRST_ID });
  assert.equal(sessions().length, 2);
});

test('delivers connected orders, queues stopped messages, and keeps mailboxes in memory', () => {
  const { service, writes } = createHarness();
  service.setOrchestrator(FIRST_ID);
  writes.length = 0;

  const queued = service.sendMessage({
    message: 'Inspect the failing test.',
    requestedBy: FIRST_ID,
    targetIds: [SECOND_ID],
  });
  assert.equal(queued.kind, 'order');
  assert.equal(queued.deliveries[0].status, 'queued');

  const reply = service.sendMessage({
    message: 'I found the failure.',
    requestedBy: SECOND_ID,
    targetIds: [FIRST_ID],
  });
  assert.equal(reply.kind, 'message');
  assert.equal(reply.deliveries[0].status, 'delivered');
  assert.match(writes[0].data, /Agenza agent message from Worker/);
  assert.match(writes[0].data, /I found the failure/);

  const inbox = service.readInbox(SECOND_ID);
  assert.equal(inbox.unreadCount, 1);
  assert.equal(inbox.messages[0].message, 'Inspect the failing test.');
  assert.equal(service.readInbox(SECOND_ID).unreadCount, 0);
  assert.throws(
    () => service.sendMessage({ message: 'self', requestedBy: FIRST_ID, targetIds: [FIRST_ID] }),
    /cannot send.*itself/,
  );
});

test('exposes an authenticated loopback API and never places the token in returned state', async () => {
  const { service } = createHarness();
  await service.start();

  try {
    service.setOrchestrator(FIRST_ID);
    const environment = service.createAgentEnvironment(FIRST_ID, { PATH: 'system' }, 'C:\\tools');
    assert.match(environment.AGENZA_CONTROL_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(environment.AGENZA_AGENT_TOKEN, 'test-token');
    assert.equal(environment.PATH, 'C:\\tools;system');
    assert.doesNotMatch(JSON.stringify(service.getState()), /test-token/);

    const unauthorized = await fetch(`${environment.AGENZA_CONTROL_URL}/v1/agents`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${environment.AGENZA_CONTROL_URL}/v1/whoami`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(authorized.status, 200);
    const body = await authorized.json();
    assert.equal(body.agent.id, FIRST_ID);
    assert.equal(body.isOrchestrator, true);
  } finally {
    service.dispose();
  }
});
