const {
  FINAL_AGENT_STATUSES,
  FINAL_ORCHESTRATION_STATUSES,
  FINAL_TASK_STATUSES,
  assertGoal,
  copyValue,
  createAgentId,
  createOrchestrationId,
  createPlannerOutputSchema,
  normalizeOrchestrationOptions,
  truncateResult,
  validatePlan,
} = require('./orchestration-model');
const { createAgentInstructions, createOrchestratorInstructions } = require('./prompt-factory');
const { MAX_PERSISTED_ORCHESTRATIONS, recoverInterruptedState } = require('./orchestration-state');

class OrchestrationService {
  constructor({
    committer,
    logger = null,
    now = () => new Date().toISOString(),
    providerRegistry,
    stateStore,
    workspaceProvisioner,
  } = {}) {
    if (!stateStore || !providerRegistry || !workspaceProvisioner || !committer) {
      throw new TypeError(
        'OrchestrationService requires persistence, providers, provisioning, and commits.',
      );
    }
    this._committer = committer;
    this._logger = logger;
    this._now = now;
    this._providerRegistry = providerRegistry;
    this._stateStore = stateStore;
    this._workspaceProvisioner = workspaceProvisioner;
    this._state = null;
    this._issue = null;
    this._mutationQueue = Promise.resolve();
    this._listeners = new Set();
    this._sequence = 0;
    this._runs = new Map();
    this._providerSubscriptions = [];
    this._disposed = false;
  }

  async initialize() {
    if (this._state) throw new Error('OrchestrationService is already initialized.');
    const loaded = await this._stateStore.load();
    this._issue = loaded.issue;
    const recovery = recoverInterruptedState(loaded.state, this._now);
    this._state = recovery.state;
    if (recovery.changed) await this._stateStore.save(this._state);

    for (const providerName of this._providerRegistry.list()) {
      const provider = this._providerRegistry.get(providerName);
      this._providerSubscriptions.push(
        provider.onEvent((event) => this._handleProviderEvent(providerName, event)),
      );
    }
    return this.list();
  }

  list() {
    this._requireInitialized();
    return Object.freeze({
      issue: this._issue,
      revision: this._state.revision,
      orchestrations: copyValue(this._state.orchestrations),
    });
  }

  get(orchestrationId) {
    this._requireInitialized();
    const orchestration = this._find(orchestrationId);
    return copyValue(orchestration);
  }

  async start({ goal, options = {}, projectTerminalId } = {}) {
    this._requireInitialized();
    const validatedGoal = assertGoal(goal);
    const validatedOptions = normalizeOrchestrationOptions(options);
    const project = await this._workspaceProvisioner.resolveProject(projectTerminalId);

    const conflicting = this._state.orchestrations.find(
      (orchestration) =>
        !FINAL_ORCHESTRATION_STATUSES.has(orchestration.status) &&
        orchestration.project.repositoryRoot.toLowerCase() === project.repositoryRoot.toLowerCase(),
    );
    if (conflicting) {
      throw new Error('This project already has an active orchestration.');
    }

    const timestamp = this._now();
    const orchestrationId = createOrchestrationId();
    const orchestratorAgentId = createAgentId();
    const orchestration = {
      id: orchestrationId,
      goal: validatedGoal,
      status: 'created',
      project: copyValue(project),
      options: copyValue(validatedOptions),
      orchestratorAgentId,
      planSummary: null,
      tasks: [],
      agents: [
        {
          id: orchestratorAgentId,
          orchestrationId,
          name: 'Orchestrator',
          role: 'orchestrator',
          provider: 'codex',
          model: validatedOptions.preferredModels.codex,
          status: 'created',
          taskId: null,
          terminalId: null,
          worktreeId: null,
          threadId: null,
          turnId: null,
          branch: null,
          worktreePath: null,
          parentAgentId: null,
          createdAt: timestamp,
          startedAt: null,
          completedAt: null,
          result: null,
          error: null,
        },
      ],
      integration: { status: 'not-ready' },
      createdAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      error: null,
    };

    await this._append(orchestration);
    this._publish('orchestrator:started', orchestrationId, { agentId: orchestratorAgentId });
    const run = this._runOrchestration(orchestrationId)
      .catch((error) => this._failOrchestration(orchestrationId, error))
      .finally(() => this._runs.delete(orchestrationId));
    this._runs.set(orchestrationId, run);
    return this.get(orchestrationId);
  }

  async stop(orchestrationId) {
    const orchestration = this._find(orchestrationId);
    if (FINAL_ORCHESTRATION_STATUSES.has(orchestration.status)) return copyValue(orchestration);

    const liveAgents = orchestration.agents.filter(
      (agent) => !FINAL_AGENT_STATUSES.has(agent.status),
    );
    await Promise.allSettled(
      liveAgents.map((agent) => this._providerRegistry.get(agent.provider).stop(agent.id)),
    );
    const completedAt = this._now();
    await this._mutate(orchestrationId, (draft) => {
      draft.status = 'stopped';
      draft.completedAt = completedAt;
      draft.error = null;
      for (const agent of draft.agents) {
        if (!FINAL_AGENT_STATUSES.has(agent.status)) {
          agent.status = 'stopped';
          agent.completedAt = completedAt;
        }
      }
      for (const task of draft.tasks) {
        if (!FINAL_TASK_STATUSES.has(task.status)) {
          task.status = 'stopped';
          task.completedAt = completedAt;
        }
      }
    });
    this._publish('orchestrator:stopped', orchestrationId);
    return this.get(orchestrationId);
  }

  onEvent(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Orchestration event subscription requires a callback.');
    }
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  flush() {
    return Promise.allSettled([this._mutationQueue, ...this._runs.values()]);
  }

  dispose() {
    this._disposed = true;
    for (const unsubscribe of this._providerSubscriptions) unsubscribe();
    this._providerSubscriptions = [];
    this._listeners.clear();
    this._workspaceProvisioner.dispose?.();
  }

  async _runOrchestration(orchestrationId) {
    await this._mutate(orchestrationId, (draft) => {
      draft.status = 'planning';
      const planner = draft.agents.find(({ id }) => id === draft.orchestratorAgentId);
      planner.status = 'starting';
      planner.startedAt = this._now();
    });
    this._publish('orchestrator:planning', orchestrationId);

    let orchestration = this._find(orchestrationId);
    if (FINAL_ORCHESTRATION_STATUSES.has(orchestration.status)) return;
    const plannerAgent = orchestration.agents.find(
      ({ id }) => id === orchestration.orchestratorAgentId,
    );
    const provider = this._providerRegistry.get(plannerAgent.provider);
    const plannerRuntime = await provider.start({
      agentId: plannerAgent.id,
      cwd: orchestration.project.projectPath,
      instruction: createOrchestratorInstructions(orchestration),
      model: plannerAgent.model,
      outputSchema: createPlannerOutputSchema(orchestration.options.maxAgents),
      readOnly: true,
    });
    orchestration = this._find(orchestrationId);
    if (FINAL_ORCHESTRATION_STATUSES.has(orchestration.status)) {
      await provider.stop(plannerAgent.id);
      return;
    }
    await this._mutate(orchestrationId, (draft) => {
      const planner = draft.agents.find(({ id }) => id === plannerAgent.id);
      planner.status = 'working';
      planner.threadId = plannerRuntime.threadId;
      planner.turnId = plannerRuntime.turnId;
    });
    const plannerCompletion = await provider.waitForCompletion(plannerAgent.id);
    if (FINAL_ORCHESTRATION_STATUSES.has(this._find(orchestrationId).status)) return;
    if (plannerCompletion.status !== 'completed') {
      throw new Error(plannerCompletion.error || 'The orchestrator did not complete its plan.');
    }

    let rawPlan;
    try {
      rawPlan = JSON.parse(plannerCompletion.result);
    } catch (error) {
      throw new Error('The orchestrator returned malformed structured output.', { cause: error });
    }
    const plan = validatePlan(rawPlan, { maxAgents: orchestration.options.maxAgents });
    const createdAt = this._now();
    await this._mutate(orchestrationId, (draft) => {
      draft.status = 'running';
      draft.planSummary = plan.summary;
      const planner = draft.agents.find(({ id }) => id === plannerAgent.id);
      planner.status = 'completed';
      planner.completedAt = createdAt;
      planner.result = plan.summary;
      draft.tasks = plan.tasks.map((task) => ({
        ...task,
        orchestrationId,
        status: task.dependencies.length ? 'blocked' : 'ready',
        assignedAgentId: null,
        createdAt,
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
      }));
    });
    this._publish('agent:completed', orchestrationId, { agentId: plannerAgent.id });
    for (const task of plan.tasks) {
      this._publish('task:created', orchestrationId, { taskId: task.id });
    }
    this._publish('orchestrator:running', orchestrationId);

    await this._schedule(orchestrationId);
  }

  async _schedule(orchestrationId) {
    const running = new Map();
    while (!this._disposed) {
      const orchestration = this._find(orchestrationId);
      if (FINAL_ORCHESTRATION_STATUSES.has(orchestration.status)) return;

      await this._refreshTaskReadiness(orchestrationId);
      const current = this._find(orchestrationId);
      const ready = current.tasks
        .filter((task) => task.status === 'ready' && !running.has(task.id))
        .sort(
          (first, second) => first.priority - second.priority || first.planOrder - second.planOrder,
        );

      for (const task of ready) {
        if (running.size >= current.options.maxAgents) break;
        const promise = this._runTask(orchestrationId, task.id).finally(() =>
          running.delete(task.id),
        );
        running.set(task.id, promise);
      }

      if (running.size > 0) {
        await Promise.race(running.values());
        continue;
      }

      const latest = this._find(orchestrationId);
      if (latest.tasks.every(({ status }) => status === 'completed')) {
        await this._completeOrchestration(orchestrationId);
        return;
      }
      if (latest.tasks.some(({ status }) => status === 'failed')) {
        throw new Error('One or more orchestration tasks failed.');
      }
      if (latest.tasks.some(({ status }) => status === 'stopped')) return;
      throw new Error('No task can make progress because its dependencies are incomplete.');
    }
  }

  async _refreshTaskReadiness(orchestrationId) {
    const orchestration = this._find(orchestrationId);
    const statuses = new Map(orchestration.tasks.map((task) => [task.id, task.status]));
    const changes = orchestration.tasks.filter((task) => {
      if (!['created', 'blocked'].includes(task.status)) return false;
      return task.dependencies.every((dependencyId) => statuses.get(dependencyId) === 'completed');
    });
    if (!changes.length) return;
    await this._mutate(orchestrationId, (draft) => {
      for (const task of draft.tasks) {
        if (changes.some(({ id }) => id === task.id)) task.status = 'ready';
      }
    });
  }

  async _runTask(orchestrationId, taskId) {
    let orchestration = this._find(orchestrationId);
    const agentId = createAgentId();
    const createdAt = this._now();
    await this._mutate(orchestrationId, (draft) => {
      const task = draft.tasks.find(({ id }) => id === taskId);
      task.status = 'starting';
      task.startedAt = createdAt;
      task.assignedAgentId = agentId;
      draft.agents.push({
        id: agentId,
        orchestrationId,
        name: `Agent ${draft.agents.filter(({ taskId: assigned }) => assigned).length + 1}`,
        role: task.role,
        provider: 'codex',
        model: draft.options.preferredModels.codex,
        status: 'created',
        taskId,
        terminalId: null,
        worktreeId: null,
        threadId: null,
        turnId: null,
        branch: null,
        worktreePath: null,
        parentAgentId: draft.orchestratorAgentId,
        createdAt,
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
      });
    });
    this._publish('agent:created', orchestrationId, { agentId, taskId });
    this._publish('task:started', orchestrationId, { agentId, taskId });

    try {
      orchestration = this._find(orchestrationId);
      const task = orchestration.tasks.find(({ id }) => id === taskId);
      const workspace = await this._workspaceProvisioner.provision({
        orchestrationId,
        project: orchestration.project,
        task,
      });
      await this._mutate(orchestrationId, (draft) => {
        const agent = draft.agents.find(({ id }) => id === agentId);
        agent.terminalId = workspace.terminalId;
        agent.worktreeId = workspace.worktreeId;
        agent.branch = workspace.branch;
        agent.worktreePath = workspace.worktreePath;
        if (!FINAL_AGENT_STATUSES.has(agent.status)) agent.status = 'starting';
      });
      this._publish('worktree:created', orchestrationId, {
        agentId,
        taskId,
        terminalId: workspace.terminalId,
        worktreeId: workspace.worktreeId,
      });

      orchestration = this._find(orchestrationId);
      if (FINAL_ORCHESTRATION_STATUSES.has(orchestration.status)) return;
      const agent = orchestration.agents.find(({ id }) => id === agentId);
      const provider = this._providerRegistry.get(agent.provider);
      const runtime = await provider.start({
        agentId,
        cwd: workspace.worktreePath,
        instruction: createAgentInstructions({
          agent,
          goal: orchestration.goal,
          options: orchestration.options,
          task,
        }),
        model: agent.model,
        readOnly: false,
      });
      orchestration = this._find(orchestrationId);
      if (FINAL_ORCHESTRATION_STATUSES.has(orchestration.status)) {
        await provider.stop(agentId);
        return;
      }
      await this._mutate(orchestrationId, (draft) => {
        const liveAgent = draft.agents.find(({ id }) => id === agentId);
        const liveTask = draft.tasks.find(({ id }) => id === taskId);
        liveAgent.status = 'working';
        liveAgent.startedAt = this._now();
        liveAgent.threadId = runtime.threadId;
        liveAgent.turnId = runtime.turnId;
        liveTask.status = 'working';
      });
      this._publish('agent:started', orchestrationId, {
        agentId,
        taskId,
        terminalId: workspace.terminalId,
      });

      const completion = await provider.waitForCompletion(agentId);
      if (completion.status !== 'completed') {
        if (completion.status === 'stopped') return;
        throw new Error(completion.error || 'The agent runtime failed.');
      }
      let commit = null;
      if (orchestration.options.autoCommit) {
        const commitOperation = () =>
          this._committer.commit({ task, worktreePath: workspace.worktreePath });
        commit = this._workspaceProvisioner.enqueueRepository
          ? await this._workspaceProvisioner.enqueueRepository(
              orchestration.project.repositoryRoot,
              commitOperation,
            )
          : await commitOperation();
      }
      const completedAt = this._now();
      await this._mutate(orchestrationId, (draft) => {
        const completedAgent = draft.agents.find(({ id }) => id === agentId);
        const completedTask = draft.tasks.find(({ id }) => id === taskId);
        completedAgent.status = 'completed';
        completedAgent.completedAt = completedAt;
        completedAgent.result = truncateResult(completion.result);
        completedTask.status = 'completed';
        completedTask.completedAt = completedAt;
        completedTask.result = {
          summary: truncateResult(completion.result),
          commit: commit?.commit ?? null,
          commitCreated: commit?.created ?? false,
        };
      });
      this._publish('agent:completed', orchestrationId, {
        agentId,
        taskId,
        terminalId: workspace.terminalId,
      });
      this._publish('task:completed', orchestrationId, { agentId, taskId });
    } catch (error) {
      const completedAt = this._now();
      await this._mutate(orchestrationId, (draft) => {
        const agent = draft.agents.find(({ id }) => id === agentId);
        const task = draft.tasks.find(({ id }) => id === taskId);
        if (agent && !FINAL_AGENT_STATUSES.has(agent.status)) {
          agent.status = 'failed';
          agent.completedAt = completedAt;
          agent.error = truncateResult(error.message);
        }
        if (task && !FINAL_TASK_STATUSES.has(task.status)) {
          task.status = 'failed';
          task.completedAt = completedAt;
          task.error = truncateResult(error.message);
        }
      });
      this._publish('agent:failed', orchestrationId, { agentId, taskId });
      this._publish('task:failed', orchestrationId, { agentId, taskId });
    }
  }

  async _completeOrchestration(orchestrationId) {
    const orchestration = this._find(orchestrationId);
    if (orchestration.options.requireReview) {
      await this._mutate(orchestrationId, (draft) => {
        draft.status = 'reviewing';
        draft.integration.status = 'ready-for-review';
      });
      this._publish('orchestrator:reviewing', orchestrationId);
      this._publish('integration:ready', orchestrationId);
    }
    await this._mutate(orchestrationId, (draft) => {
      draft.status = 'completed';
      draft.completedAt = this._now();
      if (!draft.options.requireReview) draft.integration.status = 'not-requested';
    });
    this._publish('orchestrator:completed', orchestrationId);
  }

  async _failOrchestration(orchestrationId, error) {
    const current = this._state?.orchestrations.find(({ id }) => id === orchestrationId);
    if (!current || FINAL_ORCHESTRATION_STATUSES.has(current.status)) return;
    const completedAt = this._now();
    await this._mutate(orchestrationId, (draft) => {
      draft.status = 'failed';
      draft.completedAt = completedAt;
      draft.error = truncateResult(error.message);
      for (const task of draft.tasks) {
        if (!FINAL_TASK_STATUSES.has(task.status)) {
          task.status = 'stopped';
          task.completedAt = completedAt;
        }
      }
    });
    this._publish('orchestrator:failed', orchestrationId);
  }

  _handleProviderEvent(providerName, event) {
    if (!['working', 'waiting'].includes(event?.type)) return;
    const match = this._state?.orchestrations.find((orchestration) =>
      orchestration.agents.some(
        (agent) => agent.id === event.runtime.agentId && agent.provider === providerName,
      ),
    );
    if (!match || FINAL_ORCHESTRATION_STATUSES.has(match.status)) return;
    this._mutate(match.id, (draft) => {
      const agent = draft.agents.find(({ id }) => id === event.runtime.agentId);
      if (!agent || FINAL_AGENT_STATUSES.has(agent.status)) return;
      agent.status = event.type;
      agent.threadId = event.runtime.threadId;
      agent.turnId = event.runtime.turnId;
    })
      .then(() =>
        this._publish('agent:status-changed', match.id, {
          agentId: event.runtime.agentId,
        }),
      )
      .catch(() => undefined);
  }

  async _append(orchestration) {
    const result = this._mutationQueue.then(async () => {
      const next = copyValue(this._state);
      next.revision += 1;
      next.orchestrations = [...next.orchestrations, copyValue(orchestration)].slice(
        -MAX_PERSISTED_ORCHESTRATIONS,
      );
      await this._stateStore.save(next);
      this._state = next;
    });
    this._mutationQueue = result.catch(() => undefined);
    return result;
  }

  async _mutate(orchestrationId, mutation) {
    const result = this._mutationQueue.then(async () => {
      const next = copyValue(this._state);
      const orchestration = next.orchestrations.find(({ id }) => id === orchestrationId);
      if (!orchestration) throw new Error(`Unknown orchestration "${orchestrationId}".`);
      mutation(orchestration);
      next.revision += 1;
      await this._stateStore.save(next);
      this._state = next;
      return copyValue(orchestration);
    });
    this._mutationQueue = result.catch(() => undefined);
    return result;
  }

  _publish(type, orchestrationId, references = {}) {
    const orchestration = this.get(orchestrationId);
    const event = Object.freeze({
      sequence: ++this._sequence,
      timestamp: this._now(),
      type,
      orchestrationId,
      ...references,
      orchestration,
    });
    try {
      this._logger?.info?.('orchestration.event', {
        eventType: type,
        status: orchestration.status,
        agentCount: orchestration.agents.length,
        taskCount: orchestration.tasks.length,
      });
    } catch {
      // Logging never changes orchestration behavior.
    }
    for (const listener of this._listeners) listener(event);
  }

  _find(orchestrationId) {
    this._requireInitialized();
    const orchestration = this._state.orchestrations.find(({ id }) => id === orchestrationId);
    if (!orchestration) throw new Error(`Unknown orchestration "${orchestrationId}".`);
    return orchestration;
  }

  _requireInitialized() {
    if (!this._state) throw new Error('OrchestrationService must be initialized before use.');
  }
}

module.exports = { OrchestrationService };
