const { randomUUID } = require('node:crypto');
const path = require('node:path');

const ORCHESTRATION_SCHEMA_VERSION = 1;
const MAX_ORCHESTRATION_GOAL_LENGTH = 20000;
const MAX_ORCHESTRATION_AGENTS = 4;
const MAX_RESULT_LENGTH = 20000;

const ORCHESTRATION_STATUSES = Object.freeze([
  'created',
  'planning',
  'running',
  'reviewing',
  'completed',
  'failed',
  'stopped',
]);
const AGENT_STATUSES = Object.freeze([
  'created',
  'starting',
  'working',
  'waiting',
  'reviewing',
  'completed',
  'failed',
  'stopped',
]);
const TASK_STATUSES = Object.freeze([
  'created',
  'blocked',
  'ready',
  'starting',
  'working',
  'reviewing',
  'completed',
  'failed',
  'stopped',
]);
const FINAL_ORCHESTRATION_STATUSES = new Set(['completed', 'failed', 'stopped']);
const FINAL_AGENT_STATUSES = new Set(['completed', 'failed', 'stopped']);
const FINAL_TASK_STATUSES = new Set(['completed', 'failed', 'stopped']);
const ORCHESTRATION_ID_PATTERN = /^orchestration-[0-9a-f-]{36}$/i;
const AGENT_ID_PATTERN = /^agent-[0-9a-f-]{36}$/i;
const TASK_ID_PATTERN = /^task-[0-9a-f-]{36}$/i;

const copyValue = (value) => JSON.parse(JSON.stringify(value));
const truncateResult = (value) =>
  typeof value === 'string' ? value.slice(0, MAX_RESULT_LENGTH) : null;

const createOrchestrationId = (uuidGenerator = randomUUID) => `orchestration-${uuidGenerator()}`;
const createAgentId = (uuidGenerator = randomUUID) => `agent-${uuidGenerator()}`;
const createTaskId = (uuidGenerator = randomUUID) => `task-${uuidGenerator()}`;

const normalizeOrchestrationOptions = (options = {}) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Orchestration options must be an object.');
  }

  const allowedKeys = new Set([
    'allowedProviders',
    'autoCommit',
    'autoMerge',
    'autoSpawn',
    'autoStop',
    'maxAgents',
    'maxDepth',
    'preferredModels',
    'requireReview',
  ]);

  if (Object.keys(options).some((key) => !allowedKeys.has(key))) {
    throw new TypeError('Orchestration options contain unsupported fields.');
  }

  const maxAgents = options.maxAgents ?? 2;
  const maxDepth = options.maxDepth ?? 1;

  if (!Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > MAX_ORCHESTRATION_AGENTS) {
    throw new RangeError(`maxAgents must be an integer between 1 and ${MAX_ORCHESTRATION_AGENTS}.`);
  }

  if (!Number.isInteger(maxDepth) || maxDepth !== 1) {
    throw new RangeError('The 0.3.0 orchestration depth must be 1.');
  }

  const allowedProviders = options.allowedProviders ?? ['codex'];

  if (
    !Array.isArray(allowedProviders) ||
    allowedProviders.length !== 1 ||
    allowedProviders[0] !== 'codex'
  ) {
    throw new Error('The 0.3.0 release supports only the Codex provider.');
  }

  const preferredModels = options.preferredModels ?? { codex: null };

  if (
    !preferredModels ||
    typeof preferredModels !== 'object' ||
    Array.isArray(preferredModels) ||
    Object.keys(preferredModels).some((provider) => provider !== 'codex') ||
    ![null, 'string'].includes(
      preferredModels.codex === null ? null : typeof preferredModels.codex,
    ) ||
    (typeof preferredModels.codex === 'string' && preferredModels.codex.length > 100)
  ) {
    throw new TypeError('preferredModels must contain an optional Codex model name.');
  }

  const booleanOption = (name, defaultValue) => {
    const value = options[name] ?? defaultValue;
    if (typeof value !== 'boolean') {
      throw new TypeError(`${name} must be a boolean.`);
    }
    return value;
  };

  const normalized = {
    maxAgents,
    maxDepth,
    allowedProviders: ['codex'],
    preferredModels: { codex: preferredModels.codex ?? null },
    autoSpawn: booleanOption('autoSpawn', true),
    autoStop: booleanOption('autoStop', true),
    autoCommit: booleanOption('autoCommit', true),
    autoMerge: booleanOption('autoMerge', false),
    requireReview: booleanOption('requireReview', true),
  };

  if (!normalized.autoSpawn) {
    throw new Error('Manual agent spawning is not available in 0.3.0.');
  }

  if (normalized.autoMerge) {
    throw new Error('Automatic merge is not available in 0.3.0.');
  }

  return Object.freeze(normalized);
};

const assertGoal = (goal) => {
  if (
    typeof goal !== 'string' ||
    goal.trim().length === 0 ||
    goal.length > MAX_ORCHESTRATION_GOAL_LENGTH
  ) {
    throw new TypeError(
      `Orchestration goal must contain between 1 and ${MAX_ORCHESTRATION_GOAL_LENGTH} characters.`,
    );
  }
  return goal.trim();
};

const assertPlanText = (value, label, maximum = 4000) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
};

const assertRelativeOwnership = (value) => {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 500 ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    value.replaceAll('\\', '/').split('/').includes('..')
  ) {
    throw new Error('Task file ownership entries must be safe relative paths or globs.');
  }
  return value.trim();
};

const validatePlan = (plan, { maxAgents, taskIdFactory = createTaskId } = {}) => {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('The orchestrator returned an invalid plan.');
  }

  const planKeys = Object.keys(plan).sort();
  if (JSON.stringify(planKeys) !== JSON.stringify(['summary', 'tasks'])) {
    throw new Error('The orchestrator plan contains invalid or missing fields.');
  }

  const summary = assertPlanText(plan.summary, 'Plan summary', 4000);
  if (!Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > maxAgents) {
    throw new Error(`The plan must contain between 1 and ${maxAgents} tasks.`);
  }

  const taskKeys = new Set();
  const normalized = plan.tasks.map((task, index) => {
    const expectedKeys = [
      'acceptanceCriteria',
      'dependencies',
      'description',
      'fileOwnership',
      'key',
      'priority',
      'role',
      'title',
    ];

    if (
      !task ||
      typeof task !== 'object' ||
      Array.isArray(task) ||
      JSON.stringify(Object.keys(task).sort()) !== JSON.stringify(expectedKeys.sort())
    ) {
      throw new Error('A planned task contains invalid or missing fields.');
    }

    const key = assertPlanText(task.key, 'Task key', 80);
    if (!/^[a-z][a-z0-9-]*$/.test(key) || taskKeys.has(key)) {
      throw new Error('Task keys must be unique lowercase identifiers.');
    }
    taskKeys.add(key);

    if (!Number.isInteger(task.priority) || task.priority < 1 || task.priority > 100) {
      throw new Error('Task priority must be an integer between 1 and 100.');
    }

    if (
      !Array.isArray(task.dependencies) ||
      task.dependencies.some((dependency) => typeof dependency !== 'string') ||
      new Set(task.dependencies).size !== task.dependencies.length
    ) {
      throw new Error('Task dependencies must be a unique string array.');
    }

    if (
      !Array.isArray(task.fileOwnership) ||
      task.fileOwnership.length < 1 ||
      task.fileOwnership.length > 50
    ) {
      throw new Error('Each task requires bounded file ownership hints.');
    }

    if (
      !Array.isArray(task.acceptanceCriteria) ||
      task.acceptanceCriteria.length < 1 ||
      task.acceptanceCriteria.length > 20
    ) {
      throw new Error('Each task requires bounded acceptance criteria.');
    }

    return {
      id: taskIdFactory(),
      planKey: key,
      title: assertPlanText(task.title, 'Task title', 200),
      description: assertPlanText(task.description, 'Task description'),
      role: assertPlanText(task.role, 'Task role', 100),
      priority: task.priority,
      dependencyKeys: [...task.dependencies],
      dependencies: [],
      fileOwnership: task.fileOwnership.map(assertRelativeOwnership),
      acceptanceCriteria: task.acceptanceCriteria.map((criterion) =>
        assertPlanText(criterion, 'Task acceptance criterion', 1000),
      ),
      planOrder: index,
    };
  });

  const byKey = new Map(normalized.map((task) => [task.planKey, task]));
  for (const task of normalized) {
    if (task.dependencyKeys.includes(task.planKey)) {
      throw new Error('A task cannot depend on itself.');
    }
    task.dependencies = task.dependencyKeys.map((key) => {
      const dependency = byKey.get(key);
      if (!dependency) {
        throw new Error(`Task dependency "${key}" does not exist.`);
      }
      return dependency.id;
    });
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (task) => {
    if (visiting.has(task.id)) {
      throw new Error('Task dependencies contain a cycle.');
    }
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependencyId of task.dependencies) {
      visit(normalized.find(({ id }) => id === dependencyId));
    }
    visiting.delete(task.id);
    visited.add(task.id);
  };
  normalized.forEach(visit);

  return Object.freeze({ summary, tasks: copyValue(normalized) });
};

const createPlannerOutputSchema = (maxAgents) => ({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: maxAgents,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          role: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 100 },
          dependencies: { type: 'array', items: { type: 'string' } },
          fileOwnership: { type: 'array', minItems: 1, items: { type: 'string' } },
          acceptanceCriteria: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
        required: [
          'key',
          'title',
          'description',
          'role',
          'priority',
          'dependencies',
          'fileOwnership',
          'acceptanceCriteria',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'tasks'],
  additionalProperties: false,
});

module.exports = {
  AGENT_ID_PATTERN,
  AGENT_STATUSES,
  FINAL_AGENT_STATUSES,
  FINAL_ORCHESTRATION_STATUSES,
  FINAL_TASK_STATUSES,
  MAX_ORCHESTRATION_AGENTS,
  MAX_ORCHESTRATION_GOAL_LENGTH,
  MAX_RESULT_LENGTH,
  ORCHESTRATION_ID_PATTERN,
  ORCHESTRATION_SCHEMA_VERSION,
  ORCHESTRATION_STATUSES,
  TASK_ID_PATTERN,
  TASK_STATUSES,
  assertGoal,
  copyValue,
  createAgentId,
  createOrchestrationId,
  createPlannerOutputSchema,
  createTaskId,
  normalizeOrchestrationOptions,
  truncateResult,
  validatePlan,
};
