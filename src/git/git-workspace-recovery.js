const fs = require('node:fs');
const fsPromises = require('node:fs/promises');

const { discoverGitRepository, pathsEqual } = require('./git-discovery');

const GIT_RECOVERY_CODES = Object.freeze({
  branchMissing: 'SAVED_GIT_BRANCH_MISSING',
  repositoryChanged: 'SAVED_GIT_REPOSITORY_CHANGED',
  repositoryMissing: 'SAVED_GIT_REPOSITORY_MISSING',
  worktreeBranchChanged: 'SAVED_GIT_WORKTREE_BRANCH_CHANGED',
  worktreeMissing: 'SAVED_GIT_WORKTREE_MISSING',
  worktreeMoved: 'SAVED_GIT_WORKTREE_MOVED',
  worktreePrunable: 'SAVED_GIT_WORKTREE_PRUNABLE',
});

const GIT_RECOVERY_MESSAGES = Object.freeze({
  [GIT_RECOVERY_CODES.branchMissing]:
    'The saved branch no longer exists. Detach this assignment or restore and reassign the branch.',
  [GIT_RECOVERY_CODES.repositoryChanged]:
    'The saved path now belongs to a different Git repository. Detach or choose the intended workspace.',
  [GIT_RECOVERY_CODES.repositoryMissing]:
    'The saved Git repository is missing or inaccessible. Detach this assignment or choose another folder.',
  [GIT_RECOVERY_CODES.worktreeBranchChanged]:
    'This worktree now uses a different branch. Detach or review and reassign the current Git workspace.',
  [GIT_RECOVERY_CODES.worktreeMissing]:
    'The saved worktree is missing or no longer registered. Git metadata was not changed.',
  [GIT_RECOVERY_CODES.worktreeMoved]:
    'The saved worktree moved to another registered path. Review and reassign it before starting Codex.',
  [GIT_RECOVERY_CODES.worktreePrunable]:
    'The saved worktree registration is stale or prunable. Inspect it outside Agenza before recovery.',
});

const isReadableDirectory = async (directory, { fileSystem = fsPromises } = {}) => {
  try {
    const stats = await fileSystem.stat(directory);

    if (!stats.isDirectory()) {
      return false;
    }

    await fileSystem.access(directory, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const createStaleStatus = (code, workspace, details = {}) => ({
  branch: workspace.repository.branch,
  candidatePath: details.candidatePath ?? null,
  code,
  message: GIT_RECOVERY_MESSAGES[code],
  path: workspace.repository.worktree.path,
  recoveryPath: details.recoveryPath ?? null,
  repositoryRoot: workspace.repository.root,
  status: 'stale',
});

const inspectSavedGitWorkspace = async (
  workspace,
  {
    discover = discoverGitRepository,
    isDirectoryReadable = isReadableDirectory,
    platform = process.platform,
  } = {},
) => {
  if (
    workspace?.kind !== 'git-worktree' ||
    typeof workspace.projectPath !== 'string' ||
    typeof workspace.repository?.root !== 'string' ||
    typeof workspace.repository?.branch !== 'string' ||
    typeof workspace.repository?.worktree?.path !== 'string'
  ) {
    throw new TypeError('A saved Git worktree assignment is required for recovery inspection.');
  }

  const repositoryRoot = workspace.repository.root;
  const worktreePath = workspace.repository.worktree.path;
  const [repositoryReadable, worktreeReadable] = await Promise.all([
    isDirectoryReadable(repositoryRoot),
    isDirectoryReadable(worktreePath),
  ]);
  let discovery = null;

  for (const candidate of [
    ...(repositoryReadable ? [repositoryRoot] : []),
    ...(worktreeReadable && !pathsEqual(worktreePath, repositoryRoot, platform)
      ? [worktreePath]
      : []),
  ]) {
    try {
      discovery = await discover(candidate);
      break;
    } catch {
      // Try the other saved path before classifying the assignment as stale.
    }
  }

  if (!discovery) {
    return createStaleStatus(GIT_RECOVERY_CODES.repositoryMissing, workspace);
  }

  if (!pathsEqual(discovery.root, repositoryRoot, platform)) {
    return createStaleStatus(GIT_RECOVERY_CODES.repositoryChanged, workspace, {
      recoveryPath: discovery.root,
    });
  }

  const recoveryPath = discovery.root;
  const exactWorktree = discovery.worktrees.find(({ path: registeredPath }) =>
    pathsEqual(registeredPath, worktreePath, platform),
  );
  const branch = discovery.branches.find(({ ref }) => ref === workspace.repository.branch);

  if (!branch) {
    return createStaleStatus(GIT_RECOVERY_CODES.branchMissing, workspace, { recoveryPath });
  }

  if (!exactWorktree) {
    const branchWorktrees = discovery.worktrees.filter(
      ({ branchRef }) => branchRef === workspace.repository.branch,
    );

    if (branchWorktrees.length === 1) {
      return createStaleStatus(GIT_RECOVERY_CODES.worktreeMoved, workspace, {
        candidatePath: branchWorktrees[0].path,
        recoveryPath,
      });
    }

    return createStaleStatus(GIT_RECOVERY_CODES.worktreeMissing, workspace, { recoveryPath });
  }

  if (!worktreeReadable) {
    return createStaleStatus(GIT_RECOVERY_CODES.worktreeMissing, workspace, { recoveryPath });
  }

  if (exactWorktree.prunable) {
    return createStaleStatus(GIT_RECOVERY_CODES.worktreePrunable, workspace, { recoveryPath });
  }

  if (exactWorktree.detached || exactWorktree.branchRef !== workspace.repository.branch) {
    return createStaleStatus(GIT_RECOVERY_CODES.worktreeBranchChanged, workspace, {
      recoveryPath,
    });
  }

  return {
    branch: workspace.repository.branch,
    candidatePath: null,
    code: null,
    message: null,
    path: worktreePath,
    recoveryPath,
    repositoryRoot,
    status: 'available',
  };
};

module.exports = {
  GIT_RECOVERY_CODES,
  GIT_RECOVERY_MESSAGES,
  inspectSavedGitWorkspace,
  isReadableDirectory,
};
