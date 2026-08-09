const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  TERMINAL_SESSION_ID_PATTERN,
  createTerminalSessionId,
} = require('../terminal/terminal-manager');

const WORKSPACE_SCHEMA_VERSION = 1;
const WORKSPACE_STATE_FILENAME = 'workspace-state.json';
const WORKSPACE_BACKUP_FILENAME = 'workspace-state.backup.json';
const WORKTREE_CREATION_ID_PATTERN =
  /^worktree-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class WorkspaceStateError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'WorkspaceStateError';
  }
}

const assertExactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceStateError(`${label} must be an object.`);
  }

  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new WorkspaceStateError(`${label} contains invalid or missing fields.`);
  }
};

const assertAbsolutePath = (value, label, pathModule) => {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 32767 ||
    !pathModule.isAbsolute(value)
  ) {
    throw new WorkspaceStateError(`${label} must be an absolute path.`);
  }
};

const assertTimestamp = (value, label) => {
  const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

  if (
    typeof value !== 'string' ||
    !isoDateTimePattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new WorkspaceStateError(`${label} must be an ISO date-time string.`);
  }
};

const validateOwnership = (ownership) => {
  assertExactKeys(ownership, ['kind', 'creationId'], 'Worktree ownership');

  if (ownership.kind === 'external' && ownership.creationId === null) {
    return;
  }

  if (
    ownership.kind === 'agenza' &&
    typeof ownership.creationId === 'string' &&
    WORKTREE_CREATION_ID_PATTERN.test(ownership.creationId)
  ) {
    return;
  }

  throw new WorkspaceStateError('Worktree ownership metadata is invalid.');
};

const validateWorkspace = (workspace, pathModule) => {
  assertExactKeys(workspace, ['kind', 'projectPath', 'repository'], 'Workspace assignment');

  if (workspace.kind === 'unassigned') {
    if (workspace.projectPath !== null || workspace.repository !== null) {
      throw new WorkspaceStateError('An unassigned workspace cannot contain a path or repository.');
    }

    return;
  }

  assertAbsolutePath(workspace.projectPath, 'Project path', pathModule);

  if (workspace.kind === 'folder') {
    if (workspace.repository !== null) {
      throw new WorkspaceStateError('A folder workspace cannot contain repository metadata.');
    }

    return;
  }

  if (workspace.kind !== 'git-worktree') {
    throw new WorkspaceStateError('Workspace assignment kind is invalid.');
  }

  assertExactKeys(workspace.repository, ['root', 'branch', 'worktree'], 'Repository assignment');
  assertAbsolutePath(workspace.repository.root, 'Repository root', pathModule);

  if (
    typeof workspace.repository.branch !== 'string' ||
    workspace.repository.branch.length < 1 ||
    workspace.repository.branch.length > 1024
  ) {
    throw new WorkspaceStateError('Repository branch is invalid.');
  }

  assertExactKeys(workspace.repository.worktree, ['path', 'ownership'], 'Worktree assignment');
  assertAbsolutePath(workspace.repository.worktree.path, 'Worktree path', pathModule);
  validateOwnership(workspace.repository.worktree.ownership);

  if (
    pathModule.normalize(workspace.projectPath).toLowerCase() !==
    pathModule.normalize(workspace.repository.worktree.path).toLowerCase()
  ) {
    throw new WorkspaceStateError('Project path must match its assigned Git worktree path.');
  }
};

const validateWorkspaceState = (state, { pathModule = path.win32 } = {}) => {
  assertExactKeys(
    state,
    ['schemaVersion', 'revision', 'activeTerminalId', 'terminals'],
    'Workspace state',
  );

  if (state.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceStateError(`Unsupported workspace schema version: ${state.schemaVersion}.`);
  }

  if (!Number.isInteger(state.revision) || state.revision < 0) {
    throw new WorkspaceStateError('Workspace revision must be a non-negative integer.');
  }

  if (!Array.isArray(state.terminals)) {
    throw new WorkspaceStateError('Workspace terminals must be an array.');
  }

  const terminalIds = new Set();
  const orders = new Set();
  const worktreePaths = new Set();

  for (const terminal of state.terminals) {
    assertExactKeys(
      terminal,
      ['id', 'label', 'order', 'createdAt', 'updatedAt', 'workspace'],
      'Terminal definition',
    );

    if (typeof terminal.id !== 'string' || !TERMINAL_SESSION_ID_PATTERN.test(terminal.id)) {
      throw new WorkspaceStateError('Terminal definition id is invalid.');
    }

    if (terminalIds.has(terminal.id)) {
      throw new WorkspaceStateError('Terminal definition ids must be unique.');
    }
    terminalIds.add(terminal.id);

    if (
      typeof terminal.label !== 'string' ||
      terminal.label.length < 1 ||
      terminal.label.length > 80
    ) {
      throw new WorkspaceStateError('Terminal label is invalid.');
    }

    if (!Number.isInteger(terminal.order) || terminal.order < 0 || orders.has(terminal.order)) {
      throw new WorkspaceStateError('Terminal order values must be unique non-negative integers.');
    }
    orders.add(terminal.order);
    assertTimestamp(terminal.createdAt, 'Terminal createdAt');
    assertTimestamp(terminal.updatedAt, 'Terminal updatedAt');
    validateWorkspace(terminal.workspace, pathModule);

    if (terminal.workspace.kind === 'git-worktree') {
      const canonicalPath = pathModule
        .normalize(terminal.workspace.repository.worktree.path)
        .toLowerCase();

      if (worktreePaths.has(canonicalPath)) {
        throw new WorkspaceStateError('One Git worktree cannot be assigned to multiple terminals.');
      }
      worktreePaths.add(canonicalPath);
    }
  }

  if ([...orders].some((order) => order >= state.terminals.length)) {
    throw new WorkspaceStateError('Terminal order values must be contiguous from zero.');
  }

  if (
    state.activeTerminalId !== null &&
    (typeof state.activeTerminalId !== 'string' || !terminalIds.has(state.activeTerminalId))
  ) {
    throw new WorkspaceStateError('Active terminal id must reference a stored terminal.');
  }

  return state;
};

const createUnassignedWorkspace = () => ({
  kind: 'unassigned',
  projectPath: null,
  repository: null,
});

const createDefaultWorkspaceState = ({
  idFactory = createTerminalSessionId,
  now = () => new Date().toISOString(),
} = {}) => {
  const timestamp = now();
  const terminals = [1, 2].map((number, order) => ({
    id: idFactory(),
    label: `Terminal ${number}`,
    order,
    createdAt: timestamp,
    updatedAt: timestamp,
    workspace: createUnassignedWorkspace(),
  }));

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    revision: 0,
    activeTerminalId: terminals[0].id,
    terminals,
  };
};

const createRecoveryWorkspaceState = (options) => createDefaultWorkspaceState(options);

class WorkspaceStateStore {
  constructor({ directory, fileSystem = fs, idFactory, now, pathModule = path } = {}) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new TypeError('Workspace state storage requires a directory.');
    }

    this.directory = directory;
    this.filePath = pathModule.join(directory, WORKSPACE_STATE_FILENAME);
    this.backupPath = pathModule.join(directory, WORKSPACE_BACKUP_FILENAME);
    this._fileSystem = fileSystem;
    this._idFactory = idFactory;
    this._now = now;
    this._pathModule = pathModule;
    this._isWritable = true;
  }

  async load() {
    let source;

    try {
      source = await this._fileSystem.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new WorkspaceStateError('Unable to read the saved workspace state.', {
          cause: error,
        });
      }

      const state = createDefaultWorkspaceState({ idFactory: this._idFactory, now: this._now });
      await this.save(state);
      return { canPersist: true, issue: null, source: 'default', state };
    }

    try {
      const state = JSON.parse(source);
      validateWorkspaceState(state);
      return { canPersist: true, issue: null, source: 'saved', state };
    } catch {
      this._isWritable = false;
      return {
        canPersist: false,
        issue:
          'The saved workspace state is invalid or from a newer Agenza version. The original file was preserved.',
        source: 'recovery',
        state: createRecoveryWorkspaceState({ idFactory: this._idFactory, now: this._now }),
      };
    }
  }

  async save(state) {
    if (!this._isWritable) {
      throw new WorkspaceStateError(
        'The saved workspace state must be repaired or moved before Agenza can persist changes.',
      );
    }

    validateWorkspaceState(state);
    await this._fileSystem.mkdir(this.directory, { recursive: true });

    let existingState = null;

    try {
      const currentSource = await this._fileSystem.readFile(this.filePath, 'utf8');
      existingState = JSON.parse(currentSource);
      validateWorkspaceState(existingState);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this._isWritable = false;
        throw new WorkspaceStateError(
          'The existing workspace state is invalid and was not overwritten.',
          { cause: error },
        );
      }
    }

    if (existingState && state.revision <= existingState.revision) {
      throw new WorkspaceStateError('Workspace revision must increase with every saved change.');
    }

    const temporaryPath = this._pathModule.join(
      this.directory,
      `${WORKSPACE_STATE_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await this._fileSystem.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      const writtenState = JSON.parse(await this._fileSystem.readFile(temporaryPath, 'utf8'));
      validateWorkspaceState(writtenState);

      if (existingState) {
        await this._fileSystem.copyFile(this.filePath, this.backupPath);
      }

      await this._fileSystem.rename(temporaryPath, this.filePath);
    } finally {
      await this._fileSystem.rm(temporaryPath, { force: true });
    }

    return state;
  }
}

module.exports = {
  WORKSPACE_BACKUP_FILENAME,
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_STATE_FILENAME,
  WorkspaceStateError,
  WorkspaceStateStore,
  createDefaultWorkspaceState,
  createUnassignedWorkspace,
  validateWorkspaceState,
};
