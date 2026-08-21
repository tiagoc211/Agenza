const assert = require('node:assert/strict');
const test = require('node:test');

const { AgentProviderRegistry } = require('../src/orchestration/agent-provider-registry');
const { OrchestrationService } = require('../src/orchestration/orchestration-service');
const { createDefaultOrchestrationState } = require('../src/orchestration/orchestration-state');

class FakeProvider {
  constructor(plan) {
    this.plan = plan;
    this.runtimes = new Map();
    this.listeners = new Set();
    this.workerStartOrder = [];
  }

  async start({ agentId, cwd, readOnly }) {
    const runtime = {
      agentId,
      cwd,
      status: 'working',
      threadId: `thread-${agentId}`,
      turnId: `turn-${agentId}`,
      result: null,
      error: null,
    };
    runtime.result = readOnly
      ? JSON.stringify(this.plan)
      : `Completed ${cwd.split('\\').at(-1)} with tests.`;
    runtime.status = 'completed';
    if (!readOnly) this.workerStartOrder.push(cwd);
    this.runtimes.set(agentId, runtime);
    return { ...runtime, status: 'working' };
  }

  sendInstruction() {}
  stop(agentId) {
    const runtime = this.runtimes.get(agentId);
    if (runtime) runtime.status = 'stopped';
    return Promise.resolve(runtime);
  }
  getStatus(agentId) {
    return this.runtimes.get(agentId);
  }
  waitForCompletion(agentId) {
    return Promise.resolve(this.runtimes.get(agentId));
  }
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose() {}
}

class BlockingWorkerProvider extends FakeProvider {
  constructor(plan) {
    super(plan);
    this.waiters = new Map();
  }

  async start(request) {
    if (request.readOnly) return super.start(request);
    const runtime = {
      agentId: request.agentId,
      cwd: request.cwd,
      status: 'working',
      threadId: `thread-${request.agentId}`,
      turnId: `turn-${request.agentId}`,
      result: null,
      error: null,
    };
    this.workerStartOrder.push(request.cwd);
    this.runtimes.set(request.agentId, runtime);
    return runtime;
  }

  waitForCompletion(agentId) {
    const runtime = this.runtimes.get(agentId);
    if (runtime.status !== 'working') return Promise.resolve(runtime);
    return new Promise((resolve) => this.waiters.set(agentId, resolve));
  }

  stop(agentId) {
    const runtime = this.runtimes.get(agentId);
    if (!runtime) return Promise.reject(new Error('Unknown fake runtime.'));
    runtime.status = 'stopped';
    this.waiters.get(agentId)?.(runtime);
    this.waiters.delete(agentId);
    return Promise.resolve(runtime);
  }
}

const task = (key, dependencies = []) => ({
  key,
  title: `Implement ${key}`,
  description: `Complete ${key}.`,
  role: `${key} agent`,
  priority: 10,
  dependencies,
  fileOwnership: [`src/${key}/**`],
  acceptanceCriteria: [`${key} passes.`],
});

test('plans, provisions, schedules dependencies, commits, and completes through domain state', async () => {
  let state = createDefaultOrchestrationState();
  const store = {
    load: async () => ({ issue: null, state: JSON.parse(JSON.stringify(state)) }),
    save: async (next) => {
      state = JSON.parse(JSON.stringify(next));
    },
  };
  const provider = new FakeProvider({
    summary: 'API then tests.',
    tasks: [task('api'), task('tests', ['api'])],
  });
  const providers = new AgentProviderRegistry();
  providers.register('codex', provider);
  const provisions = [];
  const commits = [];
  const service = new OrchestrationService({
    committer: {
      commit: async ({ task: plannedTask, worktreePath }) => {
        commits.push({ key: plannedTask.planKey, worktreePath });
        return { commit: `commit-${plannedTask.planKey}`, created: true };
      },
    },
    providerRegistry: providers,
    stateStore: store,
    workspaceProvisioner: {
      resolveProject: async (sourceTerminalId) => ({
        sourceTerminalId,
        projectPath: 'C:\\project',
        repositoryRoot: 'C:\\project',
        baseBranch: 'main',
        baseBranchRef: 'refs/heads/main',
        baseRevision: 'abc123',
      }),
      provision: async ({ task: plannedTask }) => {
        provisions.push(plannedTask.planKey);
        return {
          branch: `agenza/run/${plannedTask.planKey}`,
          terminalId: `terminal-${plannedTask.planKey}`,
          worktreeId: `worktree-${plannedTask.planKey}`,
          worktreePath: `C:\\worktrees\\${plannedTask.planKey}`,
        };
      },
      dispose() {},
    },
  });
  const eventTypes = [];
  await service.initialize();
  service.onEvent(({ type }) => eventTypes.push(type));
  const started = await service.start({
    goal: 'Implement API coverage.',
    options: { maxAgents: 2 },
    projectTerminalId: 'terminal-source',
  });
  await service.flush();
  const completed = service.get(started.id);

  assert.equal(completed.status, 'completed');
  assert.equal(completed.integration.status, 'ready-for-review');
  assert.deepEqual(provisions, ['api', 'tests']);
  assert.deepEqual(provider.workerStartOrder, ['C:\\worktrees\\api', 'C:\\worktrees\\tests']);
  assert.deepEqual(
    commits.map(({ key }) => key),
    ['api', 'tests'],
  );
  assert.ok(completed.tasks.every(({ status }) => status === 'completed'));
  assert.ok(completed.agents.every(({ status }) => status === 'completed'));
  assert.ok(eventTypes.includes('worktree:created'));
  assert.ok(eventTypes.includes('integration:ready'));
  assert.ok(eventTypes.includes('orchestrator:completed'));
  service.dispose();
});

test('stops live workers while preserving their terminal and worktree identities', async () => {
  let state = createDefaultOrchestrationState();
  const provider = new BlockingWorkerProvider({
    summary: 'One task.',
    tasks: [task('worker')],
  });
  const providers = new AgentProviderRegistry();
  providers.register('codex', provider);
  const service = new OrchestrationService({
    committer: { commit: async () => ({ commit: null, created: false }) },
    providerRegistry: providers,
    stateStore: {
      load: async () => ({ issue: null, state: JSON.parse(JSON.stringify(state)) }),
      save: async (next) => {
        state = JSON.parse(JSON.stringify(next));
      },
    },
    workspaceProvisioner: {
      resolveProject: async (sourceTerminalId) => ({
        sourceTerminalId,
        projectPath: 'C:\\project',
        repositoryRoot: 'C:\\project',
        baseBranch: 'main',
        baseBranchRef: 'refs/heads/main',
        baseRevision: 'abc123',
      }),
      provision: async () => ({
        branch: 'agenza/run/worker',
        terminalId: 'terminal-worker',
        worktreeId: 'worktree-worker',
        worktreePath: 'C:\\worktrees\\worker',
      }),
      dispose() {},
    },
  });
  await service.initialize();
  let resolveStarted;
  const workerStarted = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  service.onEvent((event) => {
    if (event.type === 'agent:started') resolveStarted();
  });
  const orchestration = await service.start({
    goal: 'Run until stopped.',
    options: { maxAgents: 1 },
    projectTerminalId: 'terminal-source',
  });
  await workerStarted;
  const stopped = await service.stop(orchestration.id);
  await service.flush();

  const worker = stopped.agents.find(({ taskId }) => taskId !== null);
  assert.equal(stopped.status, 'stopped');
  assert.equal(worker.status, 'stopped');
  assert.equal(worker.terminalId, 'terminal-worker');
  assert.equal(worker.worktreeId, 'worktree-worker');
  assert.equal(stopped.tasks[0].status, 'stopped');
  service.dispose();
});

test('marks the planner failed when its provider rejects startup', async () => {
  let state = createDefaultOrchestrationState();
  const provider = new FakeProvider({ summary: 'Unused.', tasks: [task('unused')] });
  provider.start = async () => {
    throw new Error('Provider startup rejected.');
  };
  const providers = new AgentProviderRegistry();
  providers.register('codex', provider);
  const service = new OrchestrationService({
    committer: { commit: async () => ({ commit: null, created: false }) },
    providerRegistry: providers,
    stateStore: {
      load: async () => ({ issue: null, state: JSON.parse(JSON.stringify(state)) }),
      save: async (next) => {
        state = JSON.parse(JSON.stringify(next));
      },
    },
    workspaceProvisioner: {
      resolveProject: async (sourceTerminalId) => ({
        sourceTerminalId,
        projectPath: 'C:\\project',
        repositoryRoot: 'C:\\project',
        baseBranch: 'main',
        baseBranchRef: 'refs/heads/main',
        baseRevision: 'abc123',
      }),
      dispose() {},
    },
  });
  await service.initialize();
  const started = await service.start({
    goal: 'Fail during planning.',
    projectTerminalId: 'terminal-source',
  });
  await service.flush();

  const failed = service.get(started.id);
  const planner = failed.agents.find(({ id }) => id === failed.orchestratorAgentId);
  assert.equal(failed.status, 'failed');
  assert.equal(planner.status, 'failed');
  assert.equal(planner.error, 'Provider startup rejected.');
  service.dispose();
});
