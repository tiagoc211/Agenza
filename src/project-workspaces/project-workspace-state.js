const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROJECT_WORKSPACE_SCHEMA_VERSION = 1;
const PROJECT_WORKSPACE_STATE_FILENAME = 'project-workspaces.json';
const PROJECT_WORKSPACE_BACKUP_FILENAME = 'project-workspaces.backup.json';
const PROJECT_WORKSPACE_ID_PATTERN =
  /^workspace-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ProjectWorkspaceStateError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ProjectWorkspaceStateError';
  }
}

const assertExactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectWorkspaceStateError(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ProjectWorkspaceStateError(`${label} contains invalid or missing fields.`);
  }
};

const assertTimestamp = (value, label) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ProjectWorkspaceStateError(`${label} must be an ISO date-time string.`);
  }
};

const validateProjectWorkspaceState = (state, { pathModule = path.win32 } = {}) => {
  assertExactKeys(
    state,
    ['schemaVersion', 'revision', 'activeWorkspaceId', 'workspaces'],
    'Project workspace state',
  );
  if (
    state.schemaVersion !== PROJECT_WORKSPACE_SCHEMA_VERSION ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.workspaces)
  ) {
    throw new ProjectWorkspaceStateError('Project workspace state is invalid.');
  }

  const workspaceIds = new Set();
  const projectPaths = new Set();
  const terminalIds = new Set();
  for (const workspace of state.workspaces) {
    assertExactKeys(
      workspace,
      ['id', 'name', 'projectPath', 'terminalIds', 'createdAt', 'updatedAt'],
      'Project workspace',
    );
    if (
      !PROJECT_WORKSPACE_ID_PATTERN.test(workspace.id) ||
      workspaceIds.has(workspace.id) ||
      typeof workspace.name !== 'string' ||
      workspace.name.length < 1 ||
      workspace.name.length > 200 ||
      typeof workspace.projectPath !== 'string' ||
      !pathModule.isAbsolute(workspace.projectPath) ||
      !Array.isArray(workspace.terminalIds)
    ) {
      throw new ProjectWorkspaceStateError('A project workspace is invalid.');
    }
    const canonicalPath = pathModule.normalize(workspace.projectPath).toLowerCase();
    if (projectPaths.has(canonicalPath)) {
      throw new ProjectWorkspaceStateError('Project workspace paths must be unique.');
    }
    workspaceIds.add(workspace.id);
    projectPaths.add(canonicalPath);
    assertTimestamp(workspace.createdAt, 'Project workspace createdAt');
    assertTimestamp(workspace.updatedAt, 'Project workspace updatedAt');
    for (const terminalId of workspace.terminalIds) {
      if (typeof terminalId !== 'string' || !terminalId || terminalIds.has(terminalId)) {
        throw new ProjectWorkspaceStateError('Terminal workspace membership is invalid.');
      }
      terminalIds.add(terminalId);
    }
  }
  if (state.activeWorkspaceId !== null && !workspaceIds.has(state.activeWorkspaceId)) {
    throw new ProjectWorkspaceStateError('The active project workspace is invalid.');
  }
  return state;
};

const createDefaultProjectWorkspaceState = () => ({
  schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
  revision: 0,
  activeWorkspaceId: null,
  workspaces: [],
});

class ProjectWorkspaceStateStore {
  constructor({ directory, fileSystem = fs, pathModule = path } = {}) {
    if (typeof directory !== 'string' || !directory) {
      throw new TypeError('Project workspace storage requires a directory.');
    }
    this.directory = directory;
    this.filePath = pathModule.join(directory, PROJECT_WORKSPACE_STATE_FILENAME);
    this.backupPath = pathModule.join(directory, PROJECT_WORKSPACE_BACKUP_FILENAME);
    this._fileSystem = fileSystem;
    this._path = pathModule;
    this._writable = true;
  }

  async load() {
    try {
      const state = JSON.parse(await this._fileSystem.readFile(this.filePath, 'utf8'));
      validateProjectWorkspaceState(state);
      return { issue: null, state };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const state = createDefaultProjectWorkspaceState();
        await this.save(state);
        return { issue: null, state };
      }
      this._writable = false;
      return {
        issue: 'The saved project workspace catalog is invalid and was preserved.',
        state: createDefaultProjectWorkspaceState(),
      };
    }
  }

  async save(state) {
    if (!this._writable) {
      throw new ProjectWorkspaceStateError('Repair or move the project workspace catalog first.');
    }
    validateProjectWorkspaceState(state);
    await this._fileSystem.mkdir(this.directory, { recursive: true });
    let existing = null;
    try {
      existing = JSON.parse(await this._fileSystem.readFile(this.filePath, 'utf8'));
      validateProjectWorkspaceState(existing);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this._writable = false;
        throw new ProjectWorkspaceStateError(
          'The existing project workspace catalog was not overwritten.',
          { cause: error },
        );
      }
    }
    if (existing && state.revision <= existing.revision) {
      throw new ProjectWorkspaceStateError(
        'Project workspace revision must increase on every write.',
      );
    }
    const temporaryPath = this._path.join(
      this.directory,
      `${PROJECT_WORKSPACE_STATE_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await this._fileSystem.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      validateProjectWorkspaceState(
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

const createProjectWorkspaceId = () => `workspace-${randomUUID()}`;

module.exports = {
  PROJECT_WORKSPACE_BACKUP_FILENAME,
  PROJECT_WORKSPACE_ID_PATTERN,
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  PROJECT_WORKSPACE_STATE_FILENAME,
  ProjectWorkspaceStateError,
  ProjectWorkspaceStateStore,
  createDefaultProjectWorkspaceState,
  createProjectWorkspaceId,
  validateProjectWorkspaceState,
};
