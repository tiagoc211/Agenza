const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');

const { runGit } = require('./git-command');
const { discoverGitRepository, pathsEqual } = require('./git-discovery');
const { readGitWorkspaceStatus } = require('./git-status');

const CLEANUP_PREVIEW_TTL_MS = 5 * 60 * 1000;

const GIT_CLEANUP_ERROR_CODES = Object.freeze({
  assigned: 'WORKTREE_CLEANUP_ASSIGNED',
  catalogSyncFailed: 'WORKTREE_CLEANUP_CATALOG_SYNC_FAILED',
  conflicted: 'WORKTREE_CLEANUP_CONFLICTED',
  dirty: 'WORKTREE_CLEANUP_DIRTY',
  invalidRequest: 'INVALID_WORKTREE_CLEANUP_REQUEST',
  locked: 'WORKTREE_CLEANUP_LOCKED',
  missing: 'WORKTREE_CLEANUP_MISSING',
  moved: 'WORKTREE_CLEANUP_MOVED',
  notOwned: 'WORKTREE_CLEANUP_NOT_OWNED',
  previewExpired: 'WORKTREE_CLEANUP_PREVIEW_EXPIRED',
  previewStale: 'WORKTREE_CLEANUP_PREVIEW_STALE',
  prunable: 'WORKTREE_CLEANUP_PRUNABLE',
  removeFailed: 'WORKTREE_CLEANUP_REMOVE_FAILED',
  staleRecordNotConfirmed: 'WORKTREE_CLEANUP_STALE_RECORD_NOT_CONFIRMED',
  untracked: 'WORKTREE_CLEANUP_UNTRACKED',
  verificationFailed: 'WORKTREE_CLEANUP_VERIFICATION_FAILED',
});

const GIT_CLEANUP_ERROR_MESSAGES = Object.freeze({
  [GIT_CLEANUP_ERROR_CODES.assigned]:
    'Remove or reassign the terminal using this worktree before cleaning it up.',
  [GIT_CLEANUP_ERROR_CODES.catalogSyncFailed]:
    'Git removed the worktree and kept its branch, but Agenza could not update its local cleanup record.',
  [GIT_CLEANUP_ERROR_CODES.conflicted]:
    'This worktree has conflicted files. Resolve and preserve the work in a normal terminal first.',
  [GIT_CLEANUP_ERROR_CODES.dirty]:
    'This worktree has tracked changes. Commit, stash, or discard them outside Agenza first.',
  [GIT_CLEANUP_ERROR_CODES.invalidRequest]: 'Choose a valid Agenza-created worktree.',
  [GIT_CLEANUP_ERROR_CODES.locked]:
    'This worktree is locked in Git. Unlock and inspect it outside Agenza first.',
  [GIT_CLEANUP_ERROR_CODES.missing]:
    'This worktree is missing or is no longer registered. Agenza did not change Git metadata.',
  [GIT_CLEANUP_ERROR_CODES.moved]:
    'This worktree is registered at another path. Agenza kept its ownership record for recovery.',
  [GIT_CLEANUP_ERROR_CODES.notOwned]:
    'Agenza can clean up only worktrees that it previously created and recorded.',
  [GIT_CLEANUP_ERROR_CODES.previewExpired]:
    'This cleanup preview expired. Review the worktree again before confirming.',
  [GIT_CLEANUP_ERROR_CODES.previewStale]:
    'The worktree changed after the preview. Review it again before confirming.',
  [GIT_CLEANUP_ERROR_CODES.prunable]:
    'This worktree registration is stale or prunable. Inspect it with Git outside Agenza first.',
  [GIT_CLEANUP_ERROR_CODES.removeFailed]:
    'Git refused to remove this worktree safely. No force option was used; inspect it outside Agenza.',
  [GIT_CLEANUP_ERROR_CODES.staleRecordNotConfirmed]:
    'This worktree is still registered, so Agenza will keep its cleanup record.',
  [GIT_CLEANUP_ERROR_CODES.untracked]:
    'This worktree has untracked files. Move, commit, or remove them outside Agenza first.',
  [GIT_CLEANUP_ERROR_CODES.verificationFailed]:
    'Git cleanup did not reach the expected safe result. Inspect the worktree registration outside Agenza.',
});

class GitWorktreeCleanupError extends Error {
  constructor(code, { cause, operationId = null } = {}) {
    super(
      GIT_CLEANUP_ERROR_MESSAGES[code] ??
        GIT_CLEANUP_ERROR_MESSAGES[GIT_CLEANUP_ERROR_CODES.removeFailed],
      { cause },
    );
    this.name = 'GitWorktreeCleanupError';
    this.code = code in GIT_CLEANUP_ERROR_MESSAGES ? code : GIT_CLEANUP_ERROR_CODES.removeFailed;
    this.operationId = operationId;
  }
}

const toGitWorktreeCleanupErrorPayload = (error) => {
  const normalized =
    error instanceof GitWorktreeCleanupError
      ? error
      : new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.removeFailed, { cause: error });

  return Object.freeze({
    code: normalized.code,
    message: normalized.message,
    operationId: normalized.operationId,
  });
};

class GitWorktreeCleanup {
  constructor({
    clock = () => Date.now(),
    discover = discoverGitRepository,
    enqueueRepository,
    fileSystem = fsPromises,
    operationIdFactory = () => `cleanup-${crypto.randomUUID()}`,
    platform = process.platform,
    previewTtlMs = CLEANUP_PREVIEW_TTL_MS,
    readStatus = readGitWorkspaceStatus,
    run = runGit,
  } = {}) {
    if (
      typeof clock !== 'function' ||
      typeof discover !== 'function' ||
      !fileSystem ||
      typeof operationIdFactory !== 'function' ||
      typeof readStatus !== 'function' ||
      typeof run !== 'function'
    ) {
      throw new TypeError(
        'Git worktree cleanup requires filesystem, discovery, status, and Git access.',
      );
    }

    this._clock = clock;
    this._discover = discover;
    this._enqueueRepository = enqueueRepository;
    this._fileSystem = fileSystem;
    this._operationIdFactory = operationIdFactory;
    this._platform = platform;
    this._previewTtlMs = previewTtlMs;
    this._previews = new Map();
    this._readStatus = readStatus;
    this._repositoryQueues = new Map();
    this._run = run;
  }

  async preview({ assignedWorktrees = [], creationId, getManagedWorktree } = {}) {
    const record = this._getOwnedRecord(creationId, getManagedWorktree);
    await this._inspect(record, assignedWorktrees);
    const preview = Object.freeze({
      branchRef: record.branchRef,
      creationId: record.creationId,
      operationId: this._operationIdFactory(),
      repositoryRoot: record.repositoryRoot,
      worktreePath: record.path,
    });
    this._previews.set(preview.operationId, {
      expiresAt: this._clock() + this._previewTtlMs,
      preview,
    });
    return preview;
  }

  confirm({ forgetManagedWorktree, getAssignedWorktrees, getManagedWorktree, operationId } = {}) {
    const cached = this._getPreview(operationId);

    if (typeof forgetManagedWorktree !== 'function') {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.invalidRequest, { operationId });
    }

    return this._enqueue(cached.repositoryRoot, async () => {
      const record = this._getOwnedRecord(cached.creationId, getManagedWorktree);
      const assignedWorktrees =
        typeof getAssignedWorktrees === 'function' ? await getAssignedWorktrees() : [];

      if (
        record.branchRef !== cached.branchRef ||
        !pathsEqual(record.path, cached.worktreePath, this._platform) ||
        !pathsEqual(record.repositoryRoot, cached.repositoryRoot, this._platform)
      ) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.previewStale, { operationId });
      }

      await this._inspect(record, assignedWorktrees);
      this._previews.delete(operationId);

      try {
        await this._run(['worktree', 'remove', record.path], { cwd: record.repositoryRoot });
      } catch (error) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.removeFailed, {
          cause: error,
          operationId,
        });
      }

      await this._verifyRemoval(record, operationId);

      try {
        await forgetManagedWorktree(record.creationId);
      } catch (error) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.catalogSyncFailed, {
          cause: error,
          operationId,
        });
      }
      return Object.freeze({
        branchPreserved: true,
        branchRef: record.branchRef,
        creationId: record.creationId,
        operationId,
        repositoryRoot: record.repositoryRoot,
        state: 'succeeded',
        worktreePath: record.path,
      });
    });
  }

  forgetStaleRecord({
    creationId,
    forgetManagedWorktree,
    getAssignedWorktrees,
    getManagedWorktree,
  } = {}) {
    const record = this._getOwnedRecord(creationId, getManagedWorktree);

    if (typeof forgetManagedWorktree !== 'function') {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.invalidRequest);
    }

    return this._enqueue(record.repositoryRoot, async () => {
      const currentRecord = this._getOwnedRecord(creationId, getManagedWorktree);
      const assignedWorktrees =
        typeof getAssignedWorktrees === 'function' ? await getAssignedWorktrees() : [];

      if (
        currentRecord.branchRef !== record.branchRef ||
        !pathsEqual(currentRecord.path, record.path, this._platform) ||
        !pathsEqual(currentRecord.repositoryRoot, record.repositoryRoot, this._platform)
      ) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.previewStale);
      }

      if (
        assignedWorktrees.some(({ path: assignedPath }) =>
          pathsEqual(assignedPath, record.path, this._platform),
        )
      ) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.assigned);
      }

      let discovery;

      try {
        discovery = await this._discover(record.repositoryRoot);
      } catch (error) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.missing, { cause: error });
      }

      const isStillRegistered = discovery.worktrees.some(({ path: registeredPath }) =>
        pathsEqual(registeredPath, record.path, this._platform),
      );

      if (isStillRegistered) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.staleRecordNotConfirmed);
      }

      const movedWorktrees = discovery.worktrees.filter(
        ({ branchRef }) => branchRef === record.branchRef,
      );

      if (movedWorktrees.length > 0) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.moved);
      }

      try {
        await forgetManagedWorktree(record.creationId);
      } catch (error) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.catalogSyncFailed, {
          cause: error,
        });
      }

      for (const [operationId, cached] of this._previews) {
        if (cached.preview.creationId === record.creationId) {
          this._previews.delete(operationId);
        }
      }

      return Object.freeze({
        branchRef: record.branchRef,
        creationId: record.creationId,
        repositoryRoot: record.repositoryRoot,
        state: 'stale-record-forgotten',
        worktreePath: record.path,
      });
    });
  }

  clearPreviews() {
    this._previews.clear();
  }

  _getOwnedRecord(creationId, getManagedWorktree) {
    if (
      typeof creationId !== 'string' ||
      creationId.length > 100 ||
      typeof getManagedWorktree !== 'function'
    ) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.invalidRequest);
    }

    const record = getManagedWorktree(creationId);

    if (!record) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.notOwned);
    }

    return record;
  }

  _getPreview(operationId) {
    if (typeof operationId !== 'string' || operationId.length > 100) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.invalidRequest);
    }

    const cached = this._previews.get(operationId);

    if (!cached || cached.expiresAt <= this._clock()) {
      this._previews.delete(operationId);
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.previewExpired, { operationId });
    }

    return cached.preview;
  }

  async _inspect(record, assignedWorktrees) {
    if (
      assignedWorktrees.some(({ path: assignedPath }) =>
        pathsEqual(assignedPath, record.path, this._platform),
      )
    ) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.assigned);
    }

    try {
      const stats = await this._fileSystem.stat(record.path);

      if (!stats.isDirectory()) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.missing);
      }
    } catch (error) {
      if (error instanceof GitWorktreeCleanupError) {
        throw error;
      }
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.missing, { cause: error });
    }

    let discovery;

    try {
      discovery = await this._discover(record.repositoryRoot);
    } catch (error) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.missing, { cause: error });
    }

    const worktree = discovery.worktrees.find(({ path: registeredPath }) =>
      pathsEqual(registeredPath, record.path, this._platform),
    );

    if (!worktree) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.missing);
    }
    if (worktree.locked) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.locked);
    }
    if (worktree.prunable) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.prunable);
    }
    if (worktree.detached || worktree.branchRef !== record.branchRef) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.previewStale);
    }

    const status = await this._readStatus(record.path);

    if (
      !pathsEqual(status.repositoryRoot, record.repositoryRoot, this._platform) ||
      !pathsEqual(status.worktreePath, record.path, this._platform) ||
      status.detached ||
      status.branchRef !== record.branchRef
    ) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.previewStale);
    }
    if (status.changes.conflicted > 0) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.conflicted);
    }
    if (status.changes.untracked > 0) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.untracked);
    }
    if (status.changes.tracked > 0 || !status.changes.isClean) {
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.dirty);
    }
  }

  async _verifyRemoval(record, operationId) {
    try {
      const discovery = await this._discover(record.repositoryRoot);
      const stillRegistered = discovery.worktrees.some(({ path: registeredPath }) =>
        pathsEqual(registeredPath, record.path, this._platform),
      );
      const branchPreserved = discovery.branches.some(({ ref }) => ref === record.branchRef);

      if (stillRegistered || !branchPreserved) {
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.verificationFailed, {
          operationId,
        });
      }

      try {
        await this._fileSystem.stat(record.path);
        throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.verificationFailed, {
          operationId,
        });
      } catch (error) {
        if (error instanceof GitWorktreeCleanupError) {
          throw error;
        }
        if (error?.code !== 'ENOENT') {
          throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.verificationFailed, {
            cause: error,
            operationId,
          });
        }
      }
    } catch (error) {
      if (error instanceof GitWorktreeCleanupError) {
        throw error;
      }
      throw new GitWorktreeCleanupError(GIT_CLEANUP_ERROR_CODES.verificationFailed, {
        cause: error,
        operationId,
      });
    }
  }

  _enqueue(repositoryRoot, operation) {
    if (typeof this._enqueueRepository === 'function') {
      return this._enqueueRepository(repositoryRoot, operation);
    }

    const previous = this._repositoryQueues.get(repositoryRoot) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result
      .catch(() => undefined)
      .finally(() => {
        if (this._repositoryQueues.get(repositoryRoot) === tail) {
          this._repositoryQueues.delete(repositoryRoot);
        }
      });
    this._repositoryQueues.set(repositoryRoot, tail);
    return result;
  }
}

module.exports = {
  CLEANUP_PREVIEW_TTL_MS,
  GIT_CLEANUP_ERROR_CODES,
  GIT_CLEANUP_ERROR_MESSAGES,
  GitWorktreeCleanup,
  GitWorktreeCleanupError,
  toGitWorktreeCleanupErrorPayload,
};
