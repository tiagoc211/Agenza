const { validateProjectFolder } = require('../project/project-folder');
const {
  createManagedWorktreeRecord,
  createUnassignedWorkspace,
  normalizeWorkspaceState,
  validateWorkspaceState,
} = require('./workspace-state');

const copyValue = (value) => JSON.parse(JSON.stringify(value));

const getNextTerminalLabel = (terminals) => {
  const highestNumber = terminals.reduce((highest, { label }) => {
    const match = /^Terminal (\d+)$/.exec(label);
    return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
  }, 0);

  return `Terminal ${highestNumber + 1}`;
};

class WorkspaceService {
  constructor({
    now = () => new Date().toISOString(),
    inspectGitWorkspace = null,
    stateStore,
    terminalManager,
    validateFolder = validateProjectFolder,
  } = {}) {
    if (
      !stateStore ||
      !terminalManager ||
      typeof validateFolder !== 'function' ||
      (inspectGitWorkspace !== null && typeof inspectGitWorkspace !== 'function')
    ) {
      throw new TypeError(
        'WorkspaceService requires state storage, a terminal manager, and folder validation.',
      );
    }

    this._now = now;
    this._inspectGitWorkspace = inspectGitWorkspace;
    this._stateStore = stateStore;
    this._terminalManager = terminalManager;
    this._validateFolder = validateFolder;
    this._state = null;
    this._recoveryIssue = null;
    this._workspaceAvailability = new Map();
    this._mutationQueue = Promise.resolve();
  }

  async initialize() {
    if (this._state) {
      throw new Error('WorkspaceService has already been initialized.');
    }

    const loaded = await this._stateStore.load();
    this._state = normalizeWorkspaceState(loaded.state);
    this._recoveryIssue = loaded.issue;

    for (const definition of [...this._state.terminals].sort((a, b) => a.order - b.order)) {
      this._terminalManager.create({ id: definition.id });
      await this._refreshWorkspaceAvailability(definition);
    }

    return this.getCatalog();
  }

  has(id) {
    return this._terminalManager.has(id);
  }

  getCatalog() {
    this._requireInitialized();
    const sessions = [...this._state.terminals]
      .sort((a, b) => a.order - b.order)
      .map((definition) => this._createSessionSnapshot(definition));

    return {
      activeTerminalId: this._state.activeTerminalId,
      recoveryIssue: this._recoveryIssue,
      revision: this._state.revision,
      schemaVersion: this._state.schemaVersion,
      sessions,
    };
  }

  list() {
    return this.getCatalog();
  }

  get(id) {
    return this._createSessionSnapshot(this._getDefinition(id));
  }

  create() {
    return this._enqueueMutation(async () => {
      const runtimeSnapshot = this._terminalManager.create();
      const timestamp = this._now();
      const definition = {
        id: runtimeSnapshot.id,
        label: getNextTerminalLabel(this._state.terminals),
        order: this._state.terminals.length,
        createdAt: timestamp,
        updatedAt: timestamp,
        workspace: createUnassignedWorkspace(),
      };
      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        activeTerminalId: definition.id,
        terminals: [...copyValue(this._state.terminals), definition],
      };

      try {
        await this._commit(nextState);
      } catch (error) {
        this._terminalManager.remove(definition.id);
        throw error;
      }

      this._workspaceAvailability.set(definition.id, { status: 'unassigned' });
      return this._createSessionSnapshot(definition);
    });
  }

  remove(id) {
    return this._enqueueMutation(async () => {
      const definition = this._getDefinition(id);
      const previousState = copyValue(this._state);
      const remaining = this._state.terminals
        .filter((terminal) => terminal.id !== id)
        .sort((a, b) => a.order - b.order)
        .map((terminal, order) => ({ ...copyValue(terminal), order }));
      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        activeTerminalId:
          this._state.activeTerminalId === id
            ? (remaining[0]?.id ?? null)
            : this._state.activeTerminalId,
        terminals: remaining,
      };

      await this._commit(nextState);

      try {
        this._terminalManager.remove(definition.id);
      } catch (error) {
        const rollbackState = {
          ...previousState,
          revision: nextState.revision + 1,
        };
        await this._commit(rollbackState);
        throw error;
      }

      this._workspaceAvailability.delete(id);
      return { id, removed: true };
    });
  }

  activate(id) {
    return this._enqueueMutation(async () => {
      if (id !== null) {
        this._getDefinition(id);
      }

      if (this._state.activeTerminalId === id) {
        return { activeTerminalId: id, revision: this._state.revision };
      }

      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        activeTerminalId: id,
      };
      await this._commit(nextState);
      return { activeTerminalId: id, revision: nextState.revision };
    });
  }

  assignFolder(id, projectPath) {
    return this._enqueueMutation(async () => {
      const definition = this._getDefinition(id);
      const validatedPath = await this._validateFolder(projectPath);
      const nextDefinition = {
        ...copyValue(definition),
        updatedAt: this._now(),
        workspace: {
          kind: 'folder',
          projectPath: validatedPath,
          repository: null,
        },
      };
      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        terminals: this._state.terminals.map((terminal) =>
          terminal.id === id ? nextDefinition : copyValue(terminal),
        ),
      };

      await this._commit(nextState);
      this._workspaceAvailability.set(id, { path: validatedPath, status: 'available' });
      return validatedPath;
    });
  }

  assignGitWorktree(id, workspace) {
    return this._enqueueMutation(async () => {
      const definition = this._getDefinition(id);

      if (!workspace || workspace.kind !== 'git-worktree') {
        throw new Error('A Git worktree assignment is required.');
      }

      const validatedPath = await this._validateFolder(workspace.projectPath);
      const previousWorkspace = definition.workspace;
      const previousAvailability = this._workspaceAvailability.get(id);
      const sameRepository =
        previousWorkspace.kind === 'git-worktree' &&
        previousWorkspace.repository.root.toLowerCase() === workspace.repository.root.toLowerCase();
      const recoversMovedWorktree =
        sameRepository &&
        previousAvailability?.code === 'SAVED_GIT_WORKTREE_MOVED' &&
        typeof previousAvailability.candidatePath === 'string' &&
        previousAvailability.candidatePath.toLowerCase() === validatedPath.toLowerCase() &&
        previousWorkspace.repository.branch === workspace.repository.branch;
      const recoversChangedBranch =
        sameRepository &&
        ['SAVED_GIT_BRANCH_MISSING', 'SAVED_GIT_WORKTREE_BRANCH_CHANGED'].includes(
          previousAvailability?.code,
        ) &&
        previousWorkspace.repository.worktree.path.toLowerCase() === validatedPath.toLowerCase();
      const preservesRecoveredOwnership =
        previousWorkspace.kind === 'git-worktree' &&
        previousWorkspace.repository.worktree.ownership.kind === 'agenza' &&
        workspace.repository?.worktree?.ownership?.kind === 'external' &&
        (recoversMovedWorktree || recoversChangedBranch);
      const committedWorkspace = {
        ...copyValue(workspace),
        projectPath: validatedPath,
        repository: {
          ...copyValue(workspace.repository),
          worktree: {
            ...copyValue(workspace.repository?.worktree),
            ownership: preservesRecoveredOwnership
              ? copyValue(previousWorkspace.repository.worktree.ownership)
              : copyValue(workspace.repository?.worktree?.ownership),
            path: validatedPath,
          },
        },
      };
      const nextDefinition = {
        ...copyValue(definition),
        updatedAt: this._now(),
        workspace: committedWorkspace,
      };
      const managedRecord =
        committedWorkspace.repository.worktree.ownership.kind === 'agenza'
          ? createManagedWorktreeRecord(committedWorkspace)
          : null;
      const existingManagedRecord = managedRecord
        ? this._state.managedWorktrees.find(
            ({ creationId }) => creationId === managedRecord.creationId,
          )
        : null;
      const managedWorktrees = existingManagedRecord
        ? this._state.managedWorktrees.map((worktree) =>
            worktree.creationId === managedRecord.creationId
              ? copyValue(managedRecord)
              : copyValue(worktree),
          )
        : [...copyValue(this._state.managedWorktrees), ...(managedRecord ? [managedRecord] : [])];
      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        managedWorktrees,
        terminals: this._state.terminals.map((terminal) =>
          terminal.id === id ? nextDefinition : copyValue(terminal),
        ),
      };

      await this._commit(nextState);
      this._workspaceAvailability.set(id, { path: validatedPath, status: 'available' });
      return this._createSessionSnapshot(nextDefinition);
    });
  }

  detachWorkspace(id) {
    return this._enqueueMutation(async () => {
      const definition = this._getDefinition(id);

      if (definition.workspace.kind === 'unassigned') {
        return this._createSessionSnapshot(definition);
      }

      await this._terminalManager.stop(id);
      const nextDefinition = {
        ...copyValue(definition),
        updatedAt: this._now(),
        workspace: createUnassignedWorkspace(),
      };
      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        terminals: this._state.terminals.map((terminal) =>
          terminal.id === id ? nextDefinition : copyValue(terminal),
        ),
      };

      await this._commit(nextState);
      this._workspaceAvailability.set(id, { status: 'unassigned' });
      return this._createSessionSnapshot(nextDefinition);
    });
  }

  getCurrentFolder(id) {
    this._getDefinition(id);
    const availability = this._workspaceAvailability.get(id);
    return availability?.status === 'available' ? availability.path : null;
  }

  getGitInspectionFolder(id) {
    const definition = this._getDefinition(id);
    const availability = this._workspaceAvailability.get(id);

    if (availability?.status === 'available') {
      return availability.path;
    }

    if (definition.workspace.kind === 'git-worktree' && availability?.status === 'stale') {
      return availability.recoveryPath ?? null;
    }

    return null;
  }

  refreshWorkspace(id) {
    return this._enqueueMutation(async () => {
      const definition = this._getDefinition(id);
      await this._refreshWorkspaceAvailability(definition);
      return this._createSessionSnapshot(definition);
    });
  }

  getInitialFolders() {
    this._requireInitialized();
    return Object.fromEntries(
      [...this._workspaceAvailability]
        .filter(([, availability]) => availability.status === 'available')
        .map(([id, availability]) => [id, availability.path]),
    );
  }

  getAssignedGitWorktrees(excludeTerminalId = null) {
    this._requireInitialized();
    return this._state.terminals
      .filter(
        (definition) =>
          definition.id !== excludeTerminalId && definition.workspace.kind === 'git-worktree',
      )
      .map((definition) => ({
        path: definition.workspace.repository.worktree.path,
        terminalId: definition.id,
      }));
  }

  getManagedWorktrees() {
    this._requireInitialized();
    const assignments = new Map(
      this.getAssignedGitWorktrees().map(({ path: worktreePath, terminalId }) => [
        worktreePath.toLowerCase(),
        terminalId,
      ]),
    );

    return copyValue(this._state.managedWorktrees).map((worktree) => ({
      ...worktree,
      assignedTerminalId: assignments.get(worktree.path.toLowerCase()) ?? null,
    }));
  }

  getManagedWorktree(creationId) {
    this._requireInitialized();
    const worktree = this._state.managedWorktrees.find(
      (candidate) => candidate.creationId === creationId,
    );
    return worktree ? copyValue(worktree) : null;
  }

  forgetManagedWorktree(creationId) {
    return this._enqueueMutation(async () => {
      const worktree = this._state.managedWorktrees.find(
        (candidate) => candidate.creationId === creationId,
      );

      if (!worktree) {
        throw new Error('Agenza does not own that worktree.');
      }

      const isAssigned = this.getAssignedGitWorktrees().some(
        ({ path: assignedPath }) => assignedPath.toLowerCase() === worktree.path.toLowerCase(),
      );

      if (isAssigned) {
        throw new Error('An assigned worktree cannot be removed from the managed catalog.');
      }

      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        managedWorktrees: this._state.managedWorktrees
          .filter((candidate) => candidate.creationId !== creationId)
          .map(copyValue),
      };
      await this._commit(nextState);
      return { creationId, removed: true };
    });
  }

  updateManagedWorktreePath(creationId, worktreePath) {
    return this._enqueueMutation(async () => {
      const worktree = this._state.managedWorktrees.find(
        (candidate) => candidate.creationId === creationId,
      );

      if (!worktree || typeof worktreePath !== 'string') {
        throw new Error('Agenza does not own that worktree.');
      }

      const isAssigned = this.getAssignedGitWorktrees().some(
        ({ path: assignedPath }) => assignedPath.toLowerCase() === worktree.path.toLowerCase(),
      );

      if (isAssigned) {
        throw new Error('An assigned worktree must be recovered through its terminal.');
      }

      const updatedRecord = { ...copyValue(worktree), path: worktreePath };
      const nextState = {
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        managedWorktrees: this._state.managedWorktrees.map((candidate) =>
          candidate.creationId === creationId ? updatedRecord : copyValue(candidate),
        ),
      };
      await this._commit(nextState);
      return copyValue(updatedRecord);
    });
  }

  flush() {
    return this._mutationQueue;
  }

  async _refreshWorkspaceAvailability(definition) {
    if (definition.workspace.kind === 'unassigned') {
      this._workspaceAvailability.set(definition.id, { status: 'unassigned' });
      return;
    }

    if (definition.workspace.kind === 'git-worktree' && this._inspectGitWorkspace) {
      try {
        const result = await this._inspectGitWorkspace(copyValue(definition.workspace));
        this._workspaceAvailability.set(definition.id, copyValue(result));
      } catch {
        this._workspaceAvailability.set(definition.id, {
          branch: definition.workspace.repository.branch,
          candidatePath: null,
          code: 'SAVED_GIT_INSPECTION_FAILED',
          message:
            'Agenza could not validate this saved Git workspace. Detach it or choose another workspace.',
          path: definition.workspace.projectPath,
          recoveryPath: null,
          repositoryRoot: definition.workspace.repository.root,
          status: 'stale',
        });
      }
      return;
    }

    try {
      const validatedPath = await this._validateFolder(definition.workspace.projectPath);
      this._workspaceAvailability.set(definition.id, {
        path: validatedPath,
        status: 'available',
      });
    } catch {
      this._workspaceAvailability.set(definition.id, {
        path: definition.workspace.projectPath,
        status: 'missing',
      });
    }
  }

  _createSessionSnapshot(definition) {
    return {
      ...this._terminalManager.getSnapshot(definition.id),
      isActive: this._state.activeTerminalId === definition.id,
      label: definition.label,
      order: definition.order,
      workspace: copyValue(definition.workspace),
      workspaceStatus: copyValue(
        this._workspaceAvailability.get(definition.id) ?? { status: 'unassigned' },
      ),
    };
  }

  async _commit(nextState) {
    validateWorkspaceState(nextState);
    await this._stateStore.save(nextState);
    this._state = copyValue(nextState);
  }

  _enqueueMutation(operation) {
    const result = this._mutationQueue.then(() => {
      this._requireInitialized();
      return operation();
    });

    this._mutationQueue = result.catch(() => undefined);
    return result;
  }

  _getDefinition(id) {
    this._requireInitialized();
    const definition = this._state.terminals.find((terminal) => terminal.id === id);

    if (!definition) {
      throw new Error(`Unknown terminal workspace "${id}".`);
    }

    return definition;
  }

  _requireInitialized() {
    if (!this._state) {
      throw new Error('WorkspaceService must be initialized before use.');
    }
  }
}

module.exports = { WorkspaceService, getNextTerminalLabel };
