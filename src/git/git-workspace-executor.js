const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');

const { runGit } = require('./git-command');
const { discoverGitRepository, pathsEqual } = require('./git-discovery');
const { GIT_PLAN_TYPES } = require('./git-workspace-planner');

const GIT_EXECUTION_ERROR_CODES = Object.freeze({
  createFailed: 'GIT_WORKSPACE_CREATE_FAILED',
  invalidConfirmation: 'INVALID_WORKSPACE_CONFIRMATION',
  manualRecovery: 'GIT_WORKSPACE_MANUAL_RECOVERY',
  verificationFailed: 'GIT_WORKSPACE_VERIFICATION_FAILED',
});

const GIT_EXECUTION_ERROR_MESSAGES = Object.freeze({
  [GIT_EXECUTION_ERROR_CODES.createFailed]:
    'Agenza could not create the branch and worktree. No pre-existing Git work was changed.',
  [GIT_EXECUTION_ERROR_CODES.invalidConfirmation]:
    'This confirmation does not match a valid new-branch preview.',
  [GIT_EXECUTION_ERROR_CODES.manualRecovery]:
    'Git created partial workspace data that Agenza could not remove safely. Inspect the previewed branch and worktree path in a normal terminal.',
  [GIT_EXECUTION_ERROR_CODES.verificationFailed]:
    'Git did not return the expected branch and worktree after creation.',
});

class GitWorkspaceExecutionError extends Error {
  constructor(code, { cause, operationId = null, rollbackState = null } = {}) {
    super(
      GIT_EXECUTION_ERROR_MESSAGES[code] ??
        GIT_EXECUTION_ERROR_MESSAGES[GIT_EXECUTION_ERROR_CODES.createFailed],
      { cause },
    );
    this.name = 'GitWorkspaceExecutionError';
    this.code =
      code in GIT_EXECUTION_ERROR_MESSAGES ? code : GIT_EXECUTION_ERROR_CODES.createFailed;
    this.operationId = operationId;
    this.rollbackState = rollbackState;
  }
}

const toGitWorkspaceExecutionErrorPayload = (error) => {
  const normalized =
    error instanceof GitWorkspaceExecutionError
      ? error
      : new GitWorkspaceExecutionError(GIT_EXECUTION_ERROR_CODES.createFailed, { cause: error });

  return Object.freeze({
    code: normalized.code,
    message: normalized.message,
    operationId: normalized.operationId,
    rollbackState: normalized.rollbackState,
  });
};

class GitWorkspaceExecutor {
  constructor({
    creationIdFactory = () => `worktree-${crypto.randomUUID()}`,
    discover = discoverGitRepository,
    fileSystem = fsPromises,
    planner,
    platform = process.platform,
    run = runGit,
  } = {}) {
    if (
      !planner ||
      typeof planner.getPreview !== 'function' ||
      typeof planner.revalidatePreview !== 'function' ||
      typeof creationIdFactory !== 'function' ||
      typeof discover !== 'function' ||
      !fileSystem ||
      typeof run !== 'function'
    ) {
      throw new TypeError(
        'GitWorkspaceExecutor requires a planner, Git discovery, and Git access.',
      );
    }

    this._creationIdFactory = creationIdFactory;
    this._discover = discover;
    this._fileSystem = fileSystem;
    this._planner = planner;
    this._platform = platform;
    this._run = run;
    this._repositoryQueues = new Map();
  }

  createNewBranch({
    assignedWorktrees = [],
    commitAssignment,
    operationId,
    projectPath,
    terminalId,
  } = {}) {
    const cachedPreview = this._planner.getPreview(operationId, terminalId);

    if (
      !cachedPreview ||
      cachedPreview.type !== GIT_PLAN_TYPES.createNewBranch ||
      typeof commitAssignment !== 'function'
    ) {
      throw new GitWorkspaceExecutionError(GIT_EXECUTION_ERROR_CODES.invalidConfirmation, {
        operationId: typeof operationId === 'string' ? operationId : null,
      });
    }

    return this._enqueueRepository(cachedPreview.repositoryRoot, async () => {
      const preview = await this._planner.revalidatePreview(operationId, terminalId, {
        assignedWorktrees,
        projectPath,
      });
      this._planner.invalidatePreview(operationId);

      try {
        await this._run(
          [
            'worktree',
            'add',
            '--no-track',
            '-b',
            preview.targetBranch,
            preview.worktreePath,
            preview.baseRevision,
          ],
          { cwd: preview.repositoryRoot },
        );
        const result = await this._verifyCreation(preview);
        const workspace = {
          kind: 'git-worktree',
          projectPath: result.worktreePath,
          repository: {
            branch: result.currentBranchRef,
            root: result.root,
            worktree: {
              ownership: {
                creationId: this._creationIdFactory(),
                kind: 'agenza',
              },
              path: result.worktreePath,
            },
          },
        };
        const workspaceSnapshot = await commitAssignment(workspace);

        return {
          operationId,
          state: 'succeeded',
          workspace,
          workspaceSnapshot,
        };
      } catch (error) {
        const rollback = await this._rollbackCreatedResources(preview);
        const code =
          rollback.state === 'rolled-back'
            ? GIT_EXECUTION_ERROR_CODES.createFailed
            : GIT_EXECUTION_ERROR_CODES.manualRecovery;
        throw new GitWorkspaceExecutionError(code, {
          cause: error,
          operationId,
          rollbackState: rollback.state,
        });
      }
    });
  }

  async _verifyCreation(preview) {
    let discovery;

    try {
      discovery = await this._discover(preview.worktreePath);
    } catch (error) {
      throw new GitWorkspaceExecutionError(GIT_EXECUTION_ERROR_CODES.verificationFailed, {
        cause: error,
        operationId: preview.operationId,
      });
    }

    if (
      !pathsEqual(discovery.root, preview.repositoryRoot, this._platform) ||
      !pathsEqual(discovery.worktreePath, preview.worktreePath, this._platform) ||
      discovery.currentBranchRef !== preview.targetBranchRef ||
      discovery.currentWorktree.head !== preview.baseRevision ||
      discovery.currentWorktree.locked ||
      discovery.currentWorktree.prunable
    ) {
      throw new GitWorkspaceExecutionError(GIT_EXECUTION_ERROR_CODES.verificationFailed, {
        operationId: preview.operationId,
      });
    }

    return discovery;
  }

  async _rollbackCreatedResources(preview) {
    try {
      let discovery = await this._discover(preview.repositoryRoot);
      const createdWorktree = discovery.worktrees.find(({ path }) =>
        pathsEqual(path, preview.worktreePath, this._platform),
      );

      if (createdWorktree) {
        if (
          createdWorktree.branchRef !== preview.targetBranchRef ||
          createdWorktree.head !== preview.baseRevision ||
          createdWorktree.locked
        ) {
          return { state: 'manual-recovery' };
        }

        await this._run(['worktree', 'remove', preview.worktreePath], {
          cwd: preview.repositoryRoot,
        });
        discovery = await this._discover(preview.repositoryRoot);
      }

      const createdBranch = discovery.branches.find(({ ref }) => ref === preview.targetBranchRef);

      if (createdBranch) {
        const stillCheckedOut = discovery.worktrees.some(
          ({ branchRef }) => branchRef === preview.targetBranchRef,
        );

        if (stillCheckedOut || createdBranch.head !== preview.baseRevision) {
          return { state: 'manual-recovery' };
        }

        await this._run(['branch', '--delete', preview.targetBranch], {
          cwd: preview.repositoryRoot,
        });
      }

      try {
        await this._fileSystem.stat(preview.worktreePath);
        return { state: 'manual-recovery' };
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          return { state: 'manual-recovery' };
        }
      }

      return { state: 'rolled-back' };
    } catch {
      return { state: 'manual-recovery' };
    }
  }

  _enqueueRepository(repositoryRoot, operation) {
    const previous = this._repositoryQueues.get(repositoryRoot) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const queueTail = result
      .catch(() => undefined)
      .finally(() => {
        if (this._repositoryQueues.get(repositoryRoot) === queueTail) {
          this._repositoryQueues.delete(repositoryRoot);
        }
      });
    this._repositoryQueues.set(repositoryRoot, queueTail);
    return result;
  }
}

module.exports = {
  GIT_EXECUTION_ERROR_CODES,
  GIT_EXECUTION_ERROR_MESSAGES,
  GitWorkspaceExecutionError,
  GitWorkspaceExecutor,
  toGitWorkspaceExecutionErrorPayload,
};
