const path = require('node:path');

const { validateProjectFolder } = require('../project/project-folder');
const {
  createProjectWorkspaceId,
  validateProjectWorkspaceState,
} = require('./project-workspace-state');

const copyValue = (value) => JSON.parse(JSON.stringify(value));
const canonicalize = (value, pathModule) => pathModule.normalize(value).toLowerCase();

class ProjectWorkspaceService {
  constructor({
    idFactory = createProjectWorkspaceId,
    now = () => new Date().toISOString(),
    pathModule = path,
    stateStore,
    terminalWorkspaceService,
    validateFolder = validateProjectFolder,
  } = {}) {
    if (
      !stateStore ||
      !terminalWorkspaceService ||
      typeof idFactory !== 'function' ||
      typeof validateFolder !== 'function'
    ) {
      throw new TypeError('ProjectWorkspaceService requires storage and terminal workspaces.');
    }
    this._idFactory = idFactory;
    this._now = now;
    this._path = pathModule;
    this._stateStore = stateStore;
    this._terminalWorkspaceService = terminalWorkspaceService;
    this._validateFolder = validateFolder;
    this._state = null;
    this._issue = null;
    this._availability = new Map();
    this._mutationQueue = Promise.resolve();
  }

  async initialize() {
    if (this._state) throw new Error('ProjectWorkspaceService has already been initialized.');
    const loaded = await this._stateStore.load();
    this._state = copyValue(loaded.state);
    this._issue = loaded.issue;
    if (!this._issue) await this._reconcileExistingTerminals();
    await this._refreshAvailability();
    return this.list();
  }

  list() {
    this._requireInitialized();
    return {
      activeWorkspaceId: this._state.activeWorkspaceId,
      issue: this._issue,
      revision: this._state.revision,
      schemaVersion: this._state.schemaVersion,
      workspaces: this._state.workspaces.map((workspace) => ({
        ...copyValue(workspace),
        status: this._availability.get(workspace.id) ?? 'missing',
      })),
    };
  }

  get(id) {
    const workspace = this._getWorkspace(id);
    return {
      ...copyValue(workspace),
      status: this._availability.get(id) ?? 'missing',
    };
  }

  getTerminal(id) {
    return this._terminalWorkspaceService.get(id);
  }

  add(projectPath) {
    return this._enqueueMutation(async () => {
      const validatedPath = await this._validateFolder(projectPath);
      const canonicalPath = canonicalize(validatedPath, this._path);
      const existing = this._state.workspaces.find(
        (workspace) => canonicalize(workspace.projectPath, this._path) === canonicalPath,
      );
      if (existing) {
        await this._commit({
          ...copyValue(this._state),
          revision: this._state.revision + 1,
          activeWorkspaceId: existing.id,
        });
        this._availability.set(existing.id, 'available');
        return this.get(existing.id);
      }
      const timestamp = this._now();
      const workspace = {
        id: this._idFactory(),
        name: this._path.basename(validatedPath),
        projectPath: validatedPath,
        terminalIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this._commit({
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        activeWorkspaceId: workspace.id,
        workspaces: [...copyValue(this._state.workspaces), workspace],
      });
      this._availability.set(workspace.id, 'available');
      return this.get(workspace.id);
    });
  }

  activate(id) {
    return this._enqueueMutation(async () => {
      this._getWorkspace(id);
      if (this._state.activeWorkspaceId !== id) {
        await this._commit({
          ...copyValue(this._state),
          revision: this._state.revision + 1,
          activeWorkspaceId: id,
        });
      }
      return this.list();
    });
  }

  createTerminal(workspaceId) {
    return this._enqueueMutation(async () => {
      const workspace = this._getWorkspace(workspaceId);
      const projectPath = await this._validateFolder(workspace.projectPath);
      const terminal = await this._terminalWorkspaceService.create();
      try {
        await this._terminalWorkspaceService.assignFolder(terminal.id, projectPath);
        const updatedAt = this._now();
        await this._commit({
          ...copyValue(this._state),
          revision: this._state.revision + 1,
          activeWorkspaceId: workspaceId,
          workspaces: this._state.workspaces.map((candidate) =>
            candidate.id === workspaceId
              ? {
                  ...copyValue(candidate),
                  terminalIds: [...candidate.terminalIds, terminal.id],
                  updatedAt,
                }
              : copyValue(candidate),
          ),
        });
        this._availability.set(workspaceId, 'available');
        return this._terminalWorkspaceService.get(terminal.id);
      } catch (error) {
        try {
          await this._terminalWorkspaceService.remove(terminal.id);
        } catch {
          // Preserve the original transaction failure.
        }
        throw error;
      }
    });
  }

  attachTerminal(workspaceId, terminalId) {
    return this._enqueueMutation(async () => {
      const workspace = this._getWorkspace(workspaceId);
      if (!this._terminalWorkspaceService.has(terminalId)) {
        throw new Error('Cannot attach an unknown terminal to a project workspace.');
      }
      if (workspace.terminalIds.includes(terminalId)) return this.get(workspaceId);
      const updatedAt = this._now();
      await this._commit({
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        workspaces: this._state.workspaces.map((candidate) => ({
          ...copyValue(candidate),
          terminalIds:
            candidate.id === workspaceId
              ? [...candidate.terminalIds, terminalId]
              : candidate.terminalIds.filter((id) => id !== terminalId),
          updatedAt: candidate.id === workspaceId ? updatedAt : candidate.updatedAt,
        })),
      });
      return this.get(workspaceId);
    });
  }

  detachTerminal(terminalId) {
    return this._enqueueMutation(async () => {
      const owner = this._state.workspaces.find(({ terminalIds }) =>
        terminalIds.includes(terminalId),
      );
      if (!owner) return this.list();
      await this._commit({
        ...copyValue(this._state),
        revision: this._state.revision + 1,
        workspaces: this._state.workspaces.map((workspace) =>
          workspace.id === owner.id
            ? {
                ...copyValue(workspace),
                terminalIds: workspace.terminalIds.filter((id) => id !== terminalId),
                updatedAt: this._now(),
              }
            : copyValue(workspace),
        ),
      });
      return this.list();
    });
  }

  async _reconcileExistingTerminals() {
    const catalog = this._terminalWorkspaceService.list();
    const sessions = Array.isArray(catalog) ? catalog : catalog.sessions;
    const sessionIds = new Set(sessions.map(({ id }) => id));
    const next = copyValue(this._state);
    let changed = false;
    const assigned = new Set();
    for (const workspace of next.workspaces) {
      const filtered = workspace.terminalIds.filter(
        (terminalId) => sessionIds.has(terminalId) && !assigned.has(terminalId),
      );
      filtered.forEach((terminalId) => assigned.add(terminalId));
      if (filtered.length !== workspace.terminalIds.length) {
        workspace.terminalIds = filtered;
        workspace.updatedAt = this._now();
        changed = true;
      }
    }
    for (const session of sessions) {
      if (assigned.has(session.id)) continue;
      const projectPath =
        session.workspace?.kind === 'folder'
          ? session.workspace.projectPath
          : session.workspace?.kind === 'git-worktree'
            ? session.workspace.repository?.root
            : null;
      if (typeof projectPath !== 'string' || !this._path.isAbsolute(projectPath)) continue;
      const canonicalPath = canonicalize(projectPath, this._path);
      let workspace = next.workspaces.find(
        (candidate) => canonicalize(candidate.projectPath, this._path) === canonicalPath,
      );
      if (!workspace) {
        const timestamp = this._now();
        workspace = {
          id: this._idFactory(),
          name: this._path.basename(projectPath),
          projectPath,
          terminalIds: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        next.workspaces.push(workspace);
      }
      workspace.terminalIds.push(session.id);
      assigned.add(session.id);
      changed = true;
    }
    if (
      next.activeWorkspaceId &&
      !next.workspaces.some(({ id }) => id === next.activeWorkspaceId)
    ) {
      next.activeWorkspaceId = null;
      changed = true;
    }
    if (!next.activeWorkspaceId && next.workspaces.length) {
      const activeTerminalId = catalog.activeTerminalId;
      next.activeWorkspaceId =
        next.workspaces.find(({ terminalIds }) => terminalIds.includes(activeTerminalId))?.id ??
        next.workspaces[0].id;
      changed = true;
    }
    if (changed) {
      next.revision += 1;
      await this._commit(next);
    }
  }

  async _refreshAvailability() {
    await Promise.all(
      this._state.workspaces.map(async (workspace) => {
        try {
          await this._validateFolder(workspace.projectPath);
          this._availability.set(workspace.id, 'available');
        } catch {
          this._availability.set(workspace.id, 'missing');
        }
      }),
    );
  }

  async _commit(nextState) {
    validateProjectWorkspaceState(nextState);
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

  _getWorkspace(id) {
    this._requireInitialized();
    const workspace = this._state.workspaces.find((candidate) => candidate.id === id);
    if (!workspace) throw new Error('Select a valid project workspace.');
    return workspace;
  }

  _requireInitialized() {
    if (!this._state) throw new Error('ProjectWorkspaceService must be initialized before use.');
  }
}

module.exports = { ProjectWorkspaceService };
