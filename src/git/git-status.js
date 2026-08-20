const path = require('node:path');

const { GIT_ERROR_CODES, GitDiscoveryError, runGit } = require('./git-command');
const { discoverGitRepository } = require('./git-discovery');

const parseStatusRecords = (output) => {
  const records = String(output).split('\0');
  let conflicted = 0;
  let tracked = 0;
  let untracked = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record === '') {
      continue;
    }

    if ((record.startsWith('1 ') || record.startsWith('2 ')) && record.length > 4) {
      const statusCode = record.slice(2, 4);

      if (!/^[.MADRCUTX]{2}$/.test(statusCode)) {
        throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
      }

      tracked += 1;

      if (record.startsWith('2 ')) {
        index += 1;

        if (!records[index]) {
          throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
        }
      }
    } else if (
      record.startsWith('u ') &&
      record.length > 4 &&
      /^[.MADRCUTX]{2}$/.test(record.slice(2, 4))
    ) {
      conflicted += 1;
    } else if (record.startsWith('? ') && record.length > 2) {
      untracked += 1;
    } else {
      throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
    }
  }

  return Object.freeze({
    conflicted,
    isClean: tracked === 0 && untracked === 0 && conflicted === 0,
    tracked,
    untracked,
  });
};

const readGitWorkspaceStatus = async (
  projectPath,
  { discover = discoverGitRepository, pathModule = path, run = runGit } = {},
) => {
  if (typeof projectPath !== 'string' || !pathModule.isAbsolute(projectPath)) {
    throw new GitDiscoveryError(GIT_ERROR_CODES.invalidRequest);
  }

  const repository = await discover(projectPath);
  const result = await run(
    ['status', '--porcelain=v2', '-z', '--untracked-files=normal', '--ignore-submodules=none'],
    { cwd: repository.worktreePath },
  );

  return Object.freeze({
    branch: repository.currentBranch,
    branchRef: repository.currentBranchRef,
    changes: parseStatusRecords(result.stdout),
    detached: repository.detached,
    repositoryRoot: repository.root,
    worktreePath: repository.worktreePath,
  });
};

module.exports = {
  parseStatusRecords,
  readGitWorkspaceStatus,
};
