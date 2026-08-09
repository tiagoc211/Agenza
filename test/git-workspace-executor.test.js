const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runGit } = require('../src/git/git-command');
const {
  GIT_EXECUTION_ERROR_CODES,
  GitWorkspaceExecutor,
} = require('../src/git/git-workspace-executor');
const {
  GIT_PLAN_ERROR_CODES,
  GIT_PLAN_TYPES,
  GitWorkspacePlanner,
} = require('../src/git/git-workspace-planner');

const TERMINAL_ID = 'terminal-11111111-1111-4111-8111-111111111111';
const CREATION_ID = 'worktree-22222222-2222-4222-8222-222222222222';
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const createRepository = () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-git-execute-'));
  const repositoryPath = path.join(temporaryDirectory, 'repository');

  fs.mkdirSync(repositoryPath);
  git(repositoryPath, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryPath, ['config', 'user.name', 'Agenza Tests']);
  git(repositoryPath, ['config', 'user.email', 'tests@agenza.local']);
  fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'pre-existing\n', 'utf8');
  git(repositoryPath, ['add', 'fixture.txt']);
  git(repositoryPath, ['commit', '--quiet', '-m', 'fixture']);
  git(repositoryPath, ['branch', 'preserved-branch']);
  return { repositoryPath, temporaryDirectory };
};

const createPreview = async (planner, repositoryPath, worktreePath, targetBranch) =>
  planner.plan({
    projectPath: repositoryPath,
    request: {
      baseBranch: 'main',
      targetBranch,
      type: GIT_PLAN_TYPES.createNewBranch,
      worktreePath,
    },
    terminalId: TERMINAL_ID,
  });

const createExistingBranchPreview = async (planner, repositoryPath, worktreePath, targetBranch) =>
  planner.plan({
    projectPath: repositoryPath,
    request: {
      targetBranch,
      type: GIT_PLAN_TYPES.createExistingBranch,
      worktreePath,
    },
    terminalId: TERMINAL_ID,
  });

const createAttachPreview = async (planner, repositoryPath, worktreePath) =>
  planner.plan({
    projectPath: repositoryPath,
    request: {
      type: GIT_PLAN_TYPES.attachWorktree,
      worktreePath,
    },
    terminalId: TERMINAL_ID,
  });

test('creates, verifies, owns, and commits one isolated branch worktree', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'agent-worktree');

  try {
    const planner = new GitWorkspacePlanner();
    const preview = await createPreview(planner, repositoryPath, worktreePath, 'agent-one');
    const committed = [];
    const executor = new GitWorkspaceExecutor({
      creationIdFactory: () => CREATION_ID,
      planner,
    });
    const result = await executor.createNewBranch({
      commitAssignment: async (workspace) => {
        committed.push(workspace);
        return { id: TERMINAL_ID, workspace };
      },
      operationId: preview.operationId,
      projectPath: repositoryPath,
      terminalId: TERMINAL_ID,
    });

    assert.equal(result.state, 'succeeded');
    assert.equal(result.workspace.projectPath, path.resolve(worktreePath));
    assert.deepEqual(result.workspace.repository.worktree.ownership, {
      creationId: CREATION_ID,
      kind: 'agenza',
    });
    assert.equal(result.workspace.repository.branch, 'refs/heads/agent-one');
    assert.deepEqual(committed, [result.workspace]);
    assert.equal(git(worktreePath, ['branch', '--show-current']).trim(), 'agent-one');
    assert.equal(git(worktreePath, ['rev-parse', 'HEAD']).trim(), preview.baseRevision);
    assert.match(git(repositoryPath, ['worktree', 'list', '--porcelain']), /agent-worktree/);
    assert.equal(
      git(repositoryPath, ['branch', '--list', 'preserved-branch']).trim(),
      'preserved-branch',
    );
    assert.equal(planner.getPreview(preview.operationId, TERMINAL_ID), null);
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('refuses a stale confirmation without mutating newly changed Git state', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'stale-worktree');

  try {
    const planner = new GitWorkspacePlanner();
    const preview = await createPreview(planner, repositoryPath, worktreePath, 'stale-agent');
    const executor = new GitWorkspaceExecutor({ planner });

    git(repositoryPath, ['branch', 'external-change']);

    await assert.rejects(
      executor.createNewBranch({
        commitAssignment: async () => {
          throw new Error('must not commit');
        },
        operationId: preview.operationId,
        projectPath: repositoryPath,
        terminalId: TERMINAL_ID,
      }),
      (error) => error.code === GIT_PLAN_ERROR_CODES.previewStale,
    );

    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(repositoryPath, ['branch', '--list', 'stale-agent']).trim(), '');
    assert.equal(
      git(repositoryPath, ['branch', '--list', 'external-change']).trim(),
      'external-change',
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('creates and owns a worktree for an eligible existing branch', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'existing-branch-worktree');

  try {
    const planner = new GitWorkspacePlanner();
    const preview = await createExistingBranchPreview(
      planner,
      repositoryPath,
      worktreePath,
      'preserved-branch',
    );
    const executor = new GitWorkspaceExecutor({
      creationIdFactory: () => CREATION_ID,
      planner,
    });
    const result = await executor.createExistingBranch({
      commitAssignment: async (workspace) => ({ id: TERMINAL_ID, workspace }),
      operationId: preview.operationId,
      projectPath: repositoryPath,
      terminalId: TERMINAL_ID,
    });

    assert.equal(result.state, 'succeeded');
    assert.equal(result.workspace.repository.branch, 'refs/heads/preserved-branch');
    assert.deepEqual(result.workspace.repository.worktree.ownership, {
      creationId: CREATION_ID,
      kind: 'agenza',
    });
    assert.equal(git(worktreePath, ['branch', '--show-current']).trim(), 'preserved-branch');
    assert.equal(
      git(repositoryPath, ['branch', '--list', 'preserved-branch']).trim(),
      '+ preserved-branch',
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('rolls back an existing-branch worktree without deleting its pre-existing branch', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'existing-branch-rollback');

  try {
    const planner = new GitWorkspacePlanner();
    const preview = await createExistingBranchPreview(
      planner,
      repositoryPath,
      worktreePath,
      'preserved-branch',
    );
    const executor = new GitWorkspaceExecutor({ planner });

    await assert.rejects(
      executor.createExistingBranch({
        commitAssignment: async () => {
          throw new Error('simulated persistence failure');
        },
        operationId: preview.operationId,
        projectPath: repositoryPath,
        terminalId: TERMINAL_ID,
      }),
      (error) =>
        error.code === GIT_EXECUTION_ERROR_CODES.createFailed &&
        error.rollbackState === 'rolled-back',
    );

    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(
      git(repositoryPath, ['branch', '--list', 'preserved-branch']).trim(),
      'preserved-branch',
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('attaches an existing registered worktree without mutating or taking ownership of it', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'external-worktree');

  try {
    git(repositoryPath, ['worktree', 'add', '--quiet', worktreePath, 'preserved-branch']);
    const planner = new GitWorkspacePlanner();
    const preview = await createAttachPreview(planner, repositoryPath, worktreePath);
    const executor = new GitWorkspaceExecutor({
      planner,
      run: async () => {
        throw new Error('attachment must not run a mutating Git command');
      },
    });
    const result = await executor.attachWorktree({
      commitAssignment: async (workspace) => ({ id: TERMINAL_ID, workspace }),
      operationId: preview.operationId,
      projectPath: repositoryPath,
      terminalId: TERMINAL_ID,
    });

    assert.equal(result.state, 'succeeded');
    assert.equal(result.workspace.projectPath, path.resolve(worktreePath));
    assert.deepEqual(result.workspace.repository.worktree.ownership, {
      creationId: null,
      kind: 'external',
    });
    assert.equal(fs.existsSync(worktreePath), true);
    assert.equal(git(worktreePath, ['branch', '--show-current']).trim(), 'preserved-branch');
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('refuses attachment when another terminal acquired the worktree after preview', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'assigned-external-worktree');

  try {
    git(repositoryPath, ['worktree', 'add', '--quiet', worktreePath, 'preserved-branch']);
    const planner = new GitWorkspacePlanner();
    const preview = await createAttachPreview(planner, repositoryPath, worktreePath);
    const executor = new GitWorkspaceExecutor({ planner });
    let assignmentCommitted = false;

    await assert.rejects(
      executor.attachWorktree({
        commitAssignment: async () => {
          assignmentCommitted = true;
        },
        getAssignedWorktrees: () => [{ path: worktreePath, terminalId: 'terminal-other' }],
        operationId: preview.operationId,
        projectPath: repositoryPath,
        terminalId: TERMINAL_ID,
      }),
      (error) => error.code === GIT_PLAN_ERROR_CODES.pathAssigned,
    );

    assert.equal(assignmentCommitted, false);
    assert.equal(fs.existsSync(worktreePath), true);
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('rolls back only the newly created worktree and branch when persistence fails', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'rollback-worktree');

  try {
    const planner = new GitWorkspacePlanner();
    const preview = await createPreview(planner, repositoryPath, worktreePath, 'rollback-agent');
    const executor = new GitWorkspaceExecutor({ planner });

    await assert.rejects(
      executor.createNewBranch({
        commitAssignment: async () => {
          throw new Error('simulated persistence failure');
        },
        operationId: preview.operationId,
        projectPath: repositoryPath,
        terminalId: TERMINAL_ID,
      }),
      (error) =>
        error.code === GIT_EXECUTION_ERROR_CODES.createFailed &&
        error.rollbackState === 'rolled-back',
    );

    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(repositoryPath, ['branch', '--list', 'rollback-agent']).trim(), '');
    assert.equal(
      git(repositoryPath, ['branch', '--list', 'preserved-branch']).trim(),
      'preserved-branch',
    );
    assert.equal(
      fs.readFileSync(path.join(repositoryPath, 'fixture.txt'), 'utf8'),
      'pre-existing\n',
    );
    assert.equal(
      git(repositoryPath, ['worktree', 'list', '--porcelain']).includes(worktreePath),
      false,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('removes a branch created by a partially failed Git worktree command', async () => {
  const { repositoryPath, temporaryDirectory } = createRepository();
  const worktreePath = path.join(temporaryDirectory, 'partial-worktree');

  try {
    const planner = new GitWorkspacePlanner();
    const preview = await createPreview(planner, repositoryPath, worktreePath, 'partial-agent');
    const executor = new GitWorkspaceExecutor({
      planner,
      run: async (args, options) => {
        if (args[0] === 'worktree' && args[1] === 'add') {
          git(repositoryPath, ['branch', 'partial-agent', preview.baseRevision]);
          throw new Error('simulated partial Git failure');
        }

        return runGit(args, options);
      },
    });

    await assert.rejects(
      executor.createNewBranch({
        commitAssignment: async () => {
          throw new Error('must not commit');
        },
        operationId: preview.operationId,
        projectPath: repositoryPath,
        terminalId: TERMINAL_ID,
      }),
      (error) =>
        error.code === GIT_EXECUTION_ERROR_CODES.createFailed &&
        error.rollbackState === 'rolled-back',
    );

    assert.equal(git(repositoryPath, ['branch', '--list', 'partial-agent']).trim(), '');
    assert.equal(
      git(repositoryPath, ['branch', '--list', 'preserved-branch']).trim(),
      'preserved-branch',
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
