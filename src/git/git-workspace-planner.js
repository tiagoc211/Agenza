const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { runGit, toGitErrorPayload } = require('./git-command');
const { discoverGitRepository, pathsEqual } = require('./git-discovery');

const GIT_PLAN_TYPES = Object.freeze({
  attachWorktree: 'attach-existing-worktree',
  createExistingBranch: 'create-existing-branch-worktree',
  createNewBranch: 'create-new-branch-worktree',
});
const DEFAULT_PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_PREVIEWS = 100;

const GIT_PLAN_ERROR_CODES = Object.freeze({
  baseBranchMissing: 'BASE_BRANCH_NOT_FOUND',
  branchCheckedOut: 'BRANCH_ALREADY_CHECKED_OUT',
  branchExists: 'TARGET_BRANCH_ALREADY_EXISTS',
  branchMissing: 'TARGET_BRANCH_NOT_FOUND',
  invalidBranch: 'INVALID_BRANCH_NAME',
  invalidPath: 'INVALID_WORKTREE_PATH',
  invalidRequest: 'INVALID_WORKSPACE_PLAN',
  pathAssigned: 'WORKTREE_PATH_ASSIGNED',
  pathExists: 'WORKTREE_PATH_EXISTS',
  pathInsideWorktree: 'WORKTREE_PATH_INSIDE_WORKTREE',
  pathRegistered: 'WORKTREE_PATH_REGISTERED',
  parentUnavailable: 'WORKTREE_PARENT_UNAVAILABLE',
  repositoryUnsupported: 'UNSUPPORTED_REPOSITORY_STATE',
  worktreeDetached: 'WORKTREE_DETACHED',
  worktreeLocked: 'WORKTREE_LOCKED',
  worktreeMissing: 'WORKTREE_NOT_REGISTERED',
  worktreePrunable: 'WORKTREE_PRUNABLE',
});

const GIT_PLAN_ERROR_MESSAGES = Object.freeze({
  [GIT_PLAN_ERROR_CODES.baseBranchMissing]: 'The selected base branch does not exist locally.',
  [GIT_PLAN_ERROR_CODES.branchCheckedOut]:
    'The selected branch is already checked out in another worktree.',
  [GIT_PLAN_ERROR_CODES.branchExists]: 'The target branch already exists locally.',
  [GIT_PLAN_ERROR_CODES.branchMissing]: 'The selected target branch does not exist locally.',
  [GIT_PLAN_ERROR_CODES.invalidBranch]: 'Enter a valid local Git branch name.',
  [GIT_PLAN_ERROR_CODES.invalidPath]: 'Choose a valid absolute path for the new worktree.',
  [GIT_PLAN_ERROR_CODES.invalidRequest]: 'Agenza received an invalid workspace preview request.',
  [GIT_PLAN_ERROR_CODES.pathAssigned]:
    'That worktree path is already assigned to another terminal.',
  [GIT_PLAN_ERROR_CODES.pathExists]: 'The new worktree path already exists on disk.',
  [GIT_PLAN_ERROR_CODES.pathInsideWorktree]:
    'A new worktree cannot be created inside an existing registered worktree.',
  [GIT_PLAN_ERROR_CODES.pathRegistered]: 'That path is already registered as a Git worktree.',
  [GIT_PLAN_ERROR_CODES.parentUnavailable]:
    'The worktree parent folder must exist and be writable.',
  [GIT_PLAN_ERROR_CODES.repositoryUnsupported]:
    'This repository state is not supported for a safe worktree operation.',
  [GIT_PLAN_ERROR_CODES.worktreeDetached]:
    'The selected worktree has a detached HEAD and cannot be assigned as a branch workspace.',
  [GIT_PLAN_ERROR_CODES.worktreeLocked]: 'The selected worktree is locked in Git.',
  [GIT_PLAN_ERROR_CODES.worktreeMissing]: 'The selected path is not a registered Git worktree.',
  [GIT_PLAN_ERROR_CODES.worktreePrunable]:
    'The selected worktree registration is stale or prunable.',
});

const REQUEST_KEYS = Object.freeze({
  [GIT_PLAN_TYPES.attachWorktree]: ['type', 'worktreePath'],
  [GIT_PLAN_TYPES.createExistingBranch]: ['type', 'targetBranch', 'worktreePath'],
  [GIT_PLAN_TYPES.createNewBranch]: ['type', 'baseBranch', 'targetBranch', 'worktreePath'],
});

class GitWorkspacePlanningError extends Error {
  constructor(code, { cause } = {}) {
    super(
      GIT_PLAN_ERROR_MESSAGES[code] ?? GIT_PLAN_ERROR_MESSAGES[GIT_PLAN_ERROR_CODES.invalidRequest],
      { cause },
    );
    this.name = 'GitWorkspacePlanningError';
    this.code = code in GIT_PLAN_ERROR_MESSAGES ? code : GIT_PLAN_ERROR_CODES.invalidRequest;
  }
}

const assertExactRequest = (request) => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.invalidRequest);
  }

  const expectedKeys = REQUEST_KEYS[request.type];
  const actualKeys = Object.keys(request).sort();

  if (!expectedKeys || JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.invalidRequest);
  }
};

const branchNamesEqual = (first, second, platform = process.platform) =>
  platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;

const createDiscoveryFingerprint = (discovery, assignedWorktrees = []) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        branches: discovery.branches.map(({ head, ref, worktreePath }) => ({
          head,
          ref,
          worktreePath,
        })),
        root: discovery.root,
        terminalAssignments: assignedWorktrees
          .map(({ path: worktreePath, terminalId }) => ({ terminalId, worktreePath }))
          .sort((first, second) => first.terminalId.localeCompare(second.terminalId)),
        worktrees: discovery.worktrees.map(
          ({ branchRef, detached, head, locked, path: worktreePath, prunable }) => ({
            branchRef,
            detached,
            head,
            locked,
            path: worktreePath,
            prunable,
          }),
        ),
      }),
    )
    .digest('hex');

const freezePreview = (preview) => {
  for (const value of Object.values(preview)) {
    if (value && typeof value === 'object') {
      freezePreview(value);
    }
  }

  return Object.freeze(preview);
};

const toGitWorkspacePlanErrorPayload = (error) => {
  if (error instanceof GitWorkspacePlanningError) {
    return Object.freeze({ code: error.code, message: error.message });
  }

  return toGitErrorPayload(error);
};

class GitWorkspacePlanner {
  constructor({
    accessMode = fs.constants.R_OK | fs.constants.W_OK,
    discover = discoverGitRepository,
    fileSystem = fsPromises,
    now = () => new Date().toISOString(),
    nowMs = () => Date.now(),
    operationIdFactory = () => `operation-${crypto.randomUUID()}`,
    pathModule = path,
    platform = process.platform,
    run = runGit,
    previewTtlMs = DEFAULT_PREVIEW_TTL_MS,
  } = {}) {
    if (
      typeof discover !== 'function' ||
      !fileSystem ||
      typeof now !== 'function' ||
      typeof nowMs !== 'function' ||
      typeof operationIdFactory !== 'function' ||
      typeof run !== 'function' ||
      !Number.isInteger(previewTtlMs) ||
      previewTtlMs < 1
    ) {
      throw new TypeError('GitWorkspacePlanner requires discovery, filesystem, and Git access.');
    }

    this._accessMode = accessMode;
    this._discover = discover;
    this._fileSystem = fileSystem;
    this._now = now;
    this._nowMs = nowMs;
    this._operationIdFactory = operationIdFactory;
    this._path = pathModule;
    this._platform = platform;
    this._run = run;
    this._previewTtlMs = previewTtlMs;
    this._previews = new Map();
  }

  async plan({ assignedWorktrees = [], projectPath, request, terminalId } = {}) {
    assertExactRequest(request);

    if (
      typeof terminalId !== 'string' ||
      typeof projectPath !== 'string' ||
      !this._path.isAbsolute(projectPath) ||
      !Array.isArray(assignedWorktrees) ||
      assignedWorktrees.some(
        (assignment) =>
          !assignment ||
          typeof assignment.path !== 'string' ||
          !this._path.isAbsolute(assignment.path) ||
          typeof assignment.terminalId !== 'string',
      )
    ) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.invalidRequest);
    }

    const discovery = await this._discover(projectPath);
    this._assertSupportedRepository(discovery);

    let planDetails;

    switch (request.type) {
      case GIT_PLAN_TYPES.createNewBranch:
        planDetails = await this._planNewBranch(discovery, request, assignedWorktrees);
        break;
      case GIT_PLAN_TYPES.createExistingBranch:
        planDetails = await this._planExistingBranch(discovery, request, assignedWorktrees);
        break;
      case GIT_PLAN_TYPES.attachWorktree:
        planDetails = await this._planExistingWorktree(discovery, request, assignedWorktrees);
        break;
      default:
        throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.invalidRequest);
    }

    const preview = freezePreview({
      operationId: this._operationIdFactory(),
      state: 'previewed',
      terminalId,
      type: request.type,
      repositoryRoot: discovery.root,
      validationFingerprint: createDiscoveryFingerprint(discovery, assignedWorktrees),
      createdAt: this._now(),
      ...planDetails,
    });
    this._storePreview(preview);
    return preview;
  }

  getPreview(operationId, terminalId) {
    this._purgeExpiredPreviews();
    const stored = this._previews.get(operationId);
    return stored?.preview.terminalId === terminalId ? stored.preview : null;
  }

  invalidatePreview(operationId) {
    return this._previews.delete(operationId);
  }

  clearPreviews() {
    this._previews.clear();
  }

  async _planNewBranch(discovery, request, assignedWorktrees) {
    await this._assertValidBranchName(discovery.root, request.baseBranch);
    await this._assertValidBranchName(discovery.root, request.targetBranch);
    const baseBranch = this._findBranch(discovery, request.baseBranch);

    if (!baseBranch) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.baseBranchMissing);
    }

    if (this._findBranch(discovery, request.targetBranch)) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.branchExists);
    }

    const worktreePath = await this._validateNewWorktreePath(
      discovery,
      request.worktreePath,
      assignedWorktrees,
    );

    return {
      baseBranch: baseBranch.name,
      baseBranchRef: baseBranch.ref,
      baseRevision: baseBranch.head,
      targetBranch: request.targetBranch,
      targetBranchRef: `refs/heads/${request.targetBranch}`,
      targetRevision: null,
      worktreePath,
    };
  }

  async _planExistingBranch(discovery, request, assignedWorktrees) {
    await this._assertValidBranchName(discovery.root, request.targetBranch);
    const targetBranch = this._findBranch(discovery, request.targetBranch);

    if (!targetBranch) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.branchMissing);
    }

    const checkedOut = discovery.worktrees.some(({ branchRef }) => branchRef === targetBranch.ref);

    if (targetBranch.worktreePath || checkedOut) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.branchCheckedOut);
    }

    const worktreePath = await this._validateNewWorktreePath(
      discovery,
      request.worktreePath,
      assignedWorktrees,
    );

    return {
      baseBranch: targetBranch.name,
      baseBranchRef: targetBranch.ref,
      baseRevision: targetBranch.head,
      targetBranch: targetBranch.name,
      targetBranchRef: targetBranch.ref,
      targetRevision: targetBranch.head,
      worktreePath,
    };
  }

  async _planExistingWorktree(discovery, request, assignedWorktrees) {
    const worktreePath = this._normalizeWorktreePath(request.worktreePath);
    this._assertNotAssigned(worktreePath, assignedWorktrees);
    const worktree = discovery.worktrees.find(({ path: registeredPath }) =>
      pathsEqual(registeredPath, worktreePath, this._platform),
    );

    if (!worktree) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.worktreeMissing);
    }

    if (worktree.locked) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.worktreeLocked);
    }

    if (worktree.prunable) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.worktreePrunable);
    }

    if (worktree.detached || !worktree.branch || !worktree.branchRef) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.worktreeDetached);
    }

    try {
      const stats = await this._fileSystem.stat(worktreePath);

      if (!stats.isDirectory()) {
        throw new Error('not-a-directory');
      }

      await this._fileSystem.access(worktreePath, this._accessMode);
    } catch (error) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.worktreePrunable, { cause: error });
    }

    return {
      baseBranch: worktree.branch,
      baseBranchRef: worktree.branchRef,
      baseRevision: worktree.head,
      targetBranch: worktree.branch,
      targetBranchRef: worktree.branchRef,
      targetRevision: worktree.head,
      worktreePath,
    };
  }

  async _assertValidBranchName(repositoryRoot, branchName) {
    if (
      typeof branchName !== 'string' ||
      branchName.length === 0 ||
      branchName.length > 1024 ||
      branchName.startsWith('refs/')
    ) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.invalidBranch);
    }

    const result = await this._run(['check-ref-format', '--branch', branchName], {
      allowedExitCodes: [0, 1, 128],
      cwd: repositoryRoot,
    });

    if (result.exitCode !== 0 || result.stdout.trim() !== branchName) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.invalidBranch);
    }
  }

  _assertSupportedRepository(discovery) {
    if (
      !discovery ||
      typeof discovery.root !== 'string' ||
      !this._path.isAbsolute(discovery.root) ||
      !Array.isArray(discovery.branches) ||
      discovery.branches.length === 0 ||
      !Array.isArray(discovery.worktrees) ||
      !discovery.currentWorktree ||
      discovery.currentWorktree.bare ||
      discovery.currentWorktree.locked ||
      discovery.currentWorktree.prunable ||
      /^0+$/.test(discovery.currentWorktree.head ?? '')
    ) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.repositoryUnsupported);
    }
  }

  _findBranch(discovery, branchName) {
    return discovery.branches.find(({ name }) =>
      branchNamesEqual(name, branchName, this._platform),
    );
  }

  _normalizeWorktreePath(worktreePath) {
    if (
      typeof worktreePath !== 'string' ||
      worktreePath.length < 3 ||
      worktreePath.length > 32767 ||
      !this._path.isAbsolute(worktreePath)
    ) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.invalidPath);
    }

    return this._path.resolve(worktreePath);
  }

  _assertNotAssigned(worktreePath, assignedWorktrees) {
    const duplicate = assignedWorktrees.some(
      (assignment) =>
        assignment &&
        typeof assignment.path === 'string' &&
        pathsEqual(this._path.resolve(assignment.path), worktreePath, this._platform),
    );

    if (duplicate) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.pathAssigned);
    }
  }

  async _validateNewWorktreePath(discovery, requestedPath, assignedWorktrees) {
    const worktreePath = this._normalizeWorktreePath(requestedPath);
    this._assertNotAssigned(worktreePath, assignedWorktrees);

    if (
      discovery.worktrees.some(({ path: registeredPath }) =>
        pathsEqual(registeredPath, worktreePath, this._platform),
      )
    ) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.pathRegistered);
    }

    if (
      discovery.worktrees.some(({ path: registeredPath }) =>
        this._isInsidePath(registeredPath, worktreePath),
      )
    ) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.pathInsideWorktree);
    }

    try {
      await this._fileSystem.stat(worktreePath);
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.pathExists);
    } catch (error) {
      if (error instanceof GitWorkspacePlanningError) {
        throw error;
      }

      if (error?.code !== 'ENOENT') {
        throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.parentUnavailable, {
          cause: error,
        });
      }
    }

    const parentPath = this._path.dirname(worktreePath);

    try {
      const parentStats = await this._fileSystem.stat(parentPath);

      if (!parentStats.isDirectory()) {
        throw new Error('not-a-directory');
      }

      await this._fileSystem.access(parentPath, this._accessMode);
    } catch (error) {
      throw new GitWorkspacePlanningError(GIT_PLAN_ERROR_CODES.parentUnavailable, {
        cause: error,
      });
    }

    return worktreePath;
  }

  _isInsidePath(parentPath, candidatePath) {
    const relative = this._path.relative(parentPath, candidatePath);
    return relative !== '' && !relative.startsWith('..') && !this._path.isAbsolute(relative);
  }

  _storePreview(preview) {
    this._purgeExpiredPreviews();

    for (const [operationId, stored] of this._previews) {
      if (stored.preview.terminalId === preview.terminalId) {
        this._previews.delete(operationId);
      }
    }

    while (this._previews.size >= MAX_ACTIVE_PREVIEWS) {
      this._previews.delete(this._previews.keys().next().value);
    }

    this._previews.set(preview.operationId, {
      expiresAt: this._nowMs() + this._previewTtlMs,
      preview,
    });
  }

  _purgeExpiredPreviews() {
    const currentTime = this._nowMs();

    for (const [operationId, stored] of this._previews) {
      if (stored.expiresAt <= currentTime) {
        this._previews.delete(operationId);
      }
    }
  }
}

module.exports = {
  DEFAULT_PREVIEW_TTL_MS,
  GIT_PLAN_ERROR_CODES,
  GIT_PLAN_ERROR_MESSAGES,
  GIT_PLAN_TYPES,
  GitWorkspacePlanner,
  GitWorkspacePlanningError,
  MAX_ACTIVE_PREVIEWS,
  branchNamesEqual,
  createDiscoveryFingerprint,
  toGitWorkspacePlanErrorPayload,
};
