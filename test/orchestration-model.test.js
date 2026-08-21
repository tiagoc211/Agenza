const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPlannerOutputSchema,
  normalizeOrchestrationOptions,
  validatePlan,
} = require('../src/orchestration/orchestration-model');
const {
  createAgentInstructions,
  createOrchestratorInstructions,
} = require('../src/orchestration/prompt-factory');

const planTask = (key, dependencies = []) => ({
  key,
  title: `Implement ${key}`,
  description: `Complete the bounded ${key} work.`,
  role: 'implementation agent',
  priority: 10,
  dependencies,
  fileOwnership: [`src/${key}/**`],
  acceptanceCriteria: [`The ${key} tests pass.`],
});

test('normalizes bounded 0.3.0 options and rejects unavailable authority', () => {
  assert.deepEqual(normalizeOrchestrationOptions({ maxAgents: 3 }), {
    maxAgents: 3,
    maxDepth: 1,
    allowedProviders: ['codex'],
    preferredModels: { codex: null },
    autoSpawn: true,
    autoStop: true,
    autoCommit: true,
    autoMerge: false,
    requireReview: true,
  });
  assert.throws(() => normalizeOrchestrationOptions({ maxAgents: 5 }), /between 1 and 4/);
  assert.throws(() => normalizeOrchestrationOptions({ autoMerge: true }), /not available/);
  assert.throws(
    () => normalizeOrchestrationOptions({ allowedProviders: ['claude'] }),
    /only the Codex provider/,
  );
});

test('validates and resolves dependency-aware structured plans', () => {
  let id = 0;
  const plan = validatePlan(
    { summary: 'Two bounded tasks.', tasks: [planTask('api'), planTask('tests', ['api'])] },
    { maxAgents: 2, taskIdFactory: () => `task-${++id}` },
  );

  assert.equal(plan.tasks.length, 2);
  assert.deepEqual(plan.tasks[1].dependencies, ['task-1']);
  assert.equal(createPlannerOutputSchema(2).properties.tasks.maxItems, 2);
  assert.throws(
    () =>
      validatePlan(
        { summary: 'Cycle.', tasks: [planTask('api', ['tests']), planTask('tests', ['api'])] },
        { maxAgents: 2, taskIdFactory: () => `task-${++id}` },
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      validatePlan(
        {
          summary: 'Unsafe path.',
          tasks: [{ ...planTask('api'), fileOwnership: ['../other-worktree/**'] }],
        },
        { maxAgents: 1 },
      ),
    /safe relative paths/,
  );
});

test('generates explicit orchestrator and worker instruction contracts', () => {
  const options = normalizeOrchestrationOptions({ maxAgents: 2 });
  const orchestrator = createOrchestratorInstructions({ goal: 'Improve tests.', options });
  const worker = createAgentInstructions({
    agent: { name: 'Agent 1', branch: 'agenza/run/tests' },
    goal: 'Improve tests.',
    options,
    task: planTask('tests'),
  });

  assert.match(orchestrator, /Do not implement the goal yourself/);
  assert.match(orchestrator, /between 1 and 2/);
  assert.match(worker, /FILE OWNERSHIP/);
  assert.match(worker, /Do not merge, rebase, cherry-pick/);
  assert.match(worker, /Agenza will create the bounded task commit/);
});
