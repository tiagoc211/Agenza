const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  AGENT_ID_PATTERN,
  AGENT_STATUSES,
  FINAL_AGENT_STATUSES,
  FINAL_ORCHESTRATION_STATUSES,
  FINAL_TASK_STATUSES,
  ORCHESTRATION_ID_PATTERN,
  ORCHESTRATION_SCHEMA_VERSION,
  ORCHESTRATION_STATUSES,
  TASK_ID_PATTERN,
  TASK_STATUSES,
  copyValue,
} = require('./orchestration-model');

const ORCHESTRATION_STATE_FILENAME = 'orchestration-state.json';
const ORCHESTRATION_BACKUP_FILENAME = 'orchestration-state.backup.json';
const MAX_PERSISTED_ORCHESTRATIONS = 20;

class OrchestrationStateError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'OrchestrationStateError';
  }
}

const assertTimestamp = (value, label, { nullable = false } = {}) => {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new OrchestrationStateError(`${label} must be an ISO date-time string.`);
  }
};

const validateOrchestrationState = (state) => {
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    state.schemaVersion !== ORCHESTRATION_SCHEMA_VERSION ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.orchestrations) ||
    state.orchestrations.length > MAX_PERSISTED_ORCHESTRATIONS
  ) {
    throw new OrchestrationStateError('Orchestration state is invalid.');
  }

  const orchestrationIds = new Set();
  for (const orchestration of state.orchestrations) {
    if (
      !ORCHESTRATION_ID_PATTERN.test(orchestration?.id ?? '') ||
      orchestrationIds.has(orchestration.id) ||
      !ORCHESTRATION_STATUSES.includes(orchestration.status) ||
      typeof orchestration.goal !== 'string' ||
      !Array.isArray(orchestration.tasks) ||
      !Array.isArray(orchestration.agents)
    ) {
      throw new OrchestrationStateError('A persisted orchestration is invalid.');
    }
    orchestrationIds.add(orchestration.id);
    assertTimestamp(orchestration.createdAt, 'Orchestration createdAt');
    assertTimestamp(orchestration.startedAt, 'Orchestration startedAt', { nullable: true });
    assertTimestamp(orchestration.completedAt, 'Orchestration completedAt', { nullable: true });

    const taskIds = new Set();
    for (const task of orchestration.tasks) {
      if (
        !TASK_ID_PATTERN.test(task?.id ?? '') ||
        taskIds.has(task.id) ||
        !TASK_STATUSES.includes(task.status) ||
        !Array.isArray(task.dependencies)
      ) {
        throw new OrchestrationStateError('A persisted orchestration task is invalid.');
      }
      taskIds.add(task.id);
    }
    for (const task of orchestration.tasks) {
      if (task.dependencies.some((dependencyId) => !taskIds.has(dependencyId))) {
        throw new OrchestrationStateError('A persisted task dependency is invalid.');
      }
    }

    const agentIds = new Set();
    for (const agent of orchestration.agents) {
      if (
        !AGENT_ID_PATTERN.test(agent?.id ?? '') ||
        agentIds.has(agent.id) ||
        !AGENT_STATUSES.includes(agent.status) ||
        (agent.taskId !== null && !taskIds.has(agent.taskId))
      ) {
        throw new OrchestrationStateError('A persisted orchestration agent is invalid.');
      }
      agentIds.add(agent.id);
    }
    if (!agentIds.has(orchestration.orchestratorAgentId)) {
      throw new OrchestrationStateError('The orchestrator agent reference is invalid.');
    }
  }
  return state;
};

const createDefaultOrchestrationState = () => ({
  schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
  revision: 0,
  orchestrations: [],
});

const recoverInterruptedState = (state, now = () => new Date().toISOString()) => {
  const recovered = copyValue(state);
  let changed = false;

  for (const orchestration of recovered.orchestrations) {
    if (FINAL_ORCHESTRATION_STATUSES.has(orchestration.status)) continue;
    changed = true;
    const completedAt = now();
    orchestration.status = 'stopped';
    orchestration.completedAt = completedAt;
    orchestration.error = 'The application closed before this orchestration finished.';
    for (const agent of orchestration.agents) {
      if (!FINAL_AGENT_STATUSES.has(agent.status)) {
        agent.status = 'stopped';
        agent.completedAt = completedAt;
      }
    }
    for (const task of orchestration.tasks) {
      if (!FINAL_TASK_STATUSES.has(task.status)) {
        task.status = 'stopped';
        task.completedAt = completedAt;
      }
    }
  }

  if (changed) recovered.revision += 1;
  return { changed, state: recovered };
};

class OrchestrationStateStore {
  constructor({ directory, fileSystem = fs, pathModule = path } = {}) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new TypeError('Orchestration state storage requires a directory.');
    }
    this.directory = directory;
    this.filePath = pathModule.join(directory, ORCHESTRATION_STATE_FILENAME);
    this.backupPath = pathModule.join(directory, ORCHESTRATION_BACKUP_FILENAME);
    this._fileSystem = fileSystem;
    this._path = pathModule;
    this._writable = true;
  }

  async load() {
    try {
      const source = await this._fileSystem.readFile(this.filePath, 'utf8');
      const state = JSON.parse(source);
      validateOrchestrationState(state);
      return { issue: null, state };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const state = createDefaultOrchestrationState();
        await this.save(state);
        return { issue: null, state };
      }
      this._writable = false;
      return {
        issue: 'The saved orchestration state is invalid and was preserved.',
        state: createDefaultOrchestrationState(),
      };
    }
  }

  async save(state) {
    if (!this._writable) {
      throw new OrchestrationStateError('Repair or move the saved orchestration state first.');
    }
    validateOrchestrationState(state);
    await this._fileSystem.mkdir(this.directory, { recursive: true });
    let existing = null;
    try {
      existing = JSON.parse(await this._fileSystem.readFile(this.filePath, 'utf8'));
      validateOrchestrationState(existing);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this._writable = false;
        throw new OrchestrationStateError('The existing orchestration state was not overwritten.', {
          cause: error,
        });
      }
    }
    if (existing && state.revision <= existing.revision) {
      throw new OrchestrationStateError('Orchestration revision must increase on every write.');
    }
    const temporaryPath = this._path.join(
      this.directory,
      `${ORCHESTRATION_STATE_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await this._fileSystem.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      validateOrchestrationState(
        JSON.parse(await this._fileSystem.readFile(temporaryPath, 'utf8')),
      );
      if (existing) await this._fileSystem.copyFile(this.filePath, this.backupPath);
      await this._fileSystem.rename(temporaryPath, this.filePath);
    } finally {
      await this._fileSystem.rm(temporaryPath, { force: true });
    }
    return state;
  }
}

module.exports = {
  MAX_PERSISTED_ORCHESTRATIONS,
  ORCHESTRATION_BACKUP_FILENAME,
  ORCHESTRATION_STATE_FILENAME,
  OrchestrationStateError,
  OrchestrationStateStore,
  createDefaultOrchestrationState,
  recoverInterruptedState,
  validateOrchestrationState,
};
