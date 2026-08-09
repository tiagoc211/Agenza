const path = require('node:path');

const { GIT_ERROR_CODES, GitDiscoveryError, runGit } = require('./git-command');

const MAX_DISCOVERED_RECORDS = 10000;
const LOCAL_BRANCH_PREFIX = 'refs/heads/';

const normalizePath = (value, pathModule = path) => pathModule.resolve(value);

const pathsEqual = (first, second, platform = process.platform) =>
  platform === 'win32'
    ? first.localeCompare(second, undefined, { sensitivity: 'accent' }) === 0
    : first === second;

const parseWorktreeRecords = (output, { pathModule = path } = {}) => {
  const records = [];
  let record = {};

  const finishRecord = () => {
    if (Object.keys(record).length === 0) {
      return;
    }

    if (typeof record.path !== 'string' || typeof record.head !== 'string') {
      throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
    }

    records.push({
      bare: record.bare === true,
      branch: record.branchRef?.startsWith(LOCAL_BRANCH_PREFIX)
        ? record.branchRef.slice(LOCAL_BRANCH_PREFIX.length)
        : null,
      branchRef: record.branchRef ?? null,
      detached: record.detached === true,
      head: record.head,
      locked: record.locked !== undefined,
      lockReason:
        typeof record.locked === 'string' && record.locked.length > 0 ? record.locked : null,
      path: normalizePath(record.path, pathModule),
      prunable: record.prunable !== undefined,
      prunableReason:
        typeof record.prunable === 'string' && record.prunable.length > 0 ? record.prunable : null,
    });
    record = {};
  };

  for (const token of String(output).split('\0')) {
    if (token === '') {
      finishRecord();
      continue;
    }

    const separator = token.indexOf(' ');
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? true : token.slice(separator + 1);

    switch (key) {
      case 'worktree':
        if (record.path !== undefined) {
          finishRecord();
        }
        record.path = value;
        break;
      case 'HEAD':
        record.head = value;
        break;
      case 'branch':
        record.branchRef = value;
        break;
      case 'bare':
      case 'detached':
      case 'locked':
      case 'prunable':
        record[key] = value;
        break;
      default:
        throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
    }

    if (records.length > MAX_DISCOVERED_RECORDS) {
      throw new GitDiscoveryError(GIT_ERROR_CODES.outputLimit);
    }
  }

  finishRecord();

  if (records.length === 0 || records.length > MAX_DISCOVERED_RECORDS) {
    throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
  }

  return records;
};

const parseBranchRecords = (output, { pathModule = path } = {}) => {
  const tokens = String(output).split('\0');
  const branches = [];
  let index = 0;

  while (index < tokens.length) {
    const branchRef = tokens[index++].replace(/^\r?\n/, '');

    if (branchRef === '') {
      break;
    }

    if (index + 2 >= tokens.length || !branchRef.startsWith(LOCAL_BRANCH_PREFIX)) {
      throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
    }

    const name = tokens[index++];
    const head = tokens[index++];
    const worktreePath = tokens[index++];

    if (!name || !/^[0-9a-f]{40,64}$/i.test(head)) {
      throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
    }

    branches.push({
      head,
      name,
      ref: branchRef,
      worktreePath: worktreePath ? normalizePath(worktreePath, pathModule) : null,
    });

    if (branches.length > MAX_DISCOVERED_RECORDS) {
      throw new GitDiscoveryError(GIT_ERROR_CODES.outputLimit);
    }
  }

  return branches;
};

const discoverGitRepository = async (
  projectPath,
  { pathModule = path, platform = process.platform, run = runGit } = {},
) => {
  if (typeof projectPath !== 'string' || !pathModule.isAbsolute(projectPath)) {
    throw new GitDiscoveryError(GIT_ERROR_CODES.invalidRequest);
  }

  const cwd = normalizePath(projectPath, pathModule);
  const topLevelResult = await run(['rev-parse', '--show-toplevel'], { cwd });

  if (!topLevelResult.stdout.trim()) {
    throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
  }

  const worktreePath = normalizePath(topLevelResult.stdout.trim(), pathModule);

  const [worktreeResult, branchResult] = await Promise.all([
    run(['worktree', 'list', '--porcelain', '-z'], { cwd: worktreePath }),
    run(
      [
        'for-each-ref',
        '--sort=refname',
        '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(worktreepath)%00',
        'refs/heads',
      ],
      { cwd: worktreePath },
    ),
  ]);
  const worktrees = parseWorktreeRecords(worktreeResult.stdout, { pathModule });
  const branches = parseBranchRecords(branchResult.stdout, { pathModule });
  const currentWorktree = worktrees.find(({ path: registeredPath }) =>
    pathsEqual(registeredPath, worktreePath, platform),
  );

  if (!currentWorktree) {
    throw new GitDiscoveryError(GIT_ERROR_CODES.unexpectedOutput);
  }

  return {
    branches,
    currentBranch: currentWorktree.branch,
    currentBranchRef: currentWorktree.branchRef,
    currentWorktree: { ...currentWorktree },
    detached: currentWorktree.detached,
    root: worktrees[0].path,
    worktreePath,
    worktrees: worktrees.map((worktree) => ({
      ...worktree,
      isCurrent: pathsEqual(worktree.path, worktreePath, platform),
    })),
  };
};

module.exports = {
  MAX_DISCOVERED_RECORDS,
  discoverGitRepository,
  parseBranchRecords,
  parseWorktreeRecords,
  pathsEqual,
};
