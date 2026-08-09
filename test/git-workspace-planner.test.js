const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  GIT_PLAN_ERROR_CODES,
  GIT_PLAN_TYPES,
  GitWorkspacePlanner,
} = require('../src/git/git-workspace-planner');

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const clone = (value) => JSON.parse(JSON.stringify(value));

const assertPlanError = async (promise, code) =>
  assert.rejects(promise, (error) => error.code === code && typeof error.message === 'string');

test('previews a new branch and worktree with exact immutable confirmation facts', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-git-plan-'));
  const repositoryPath = path.join(temporaryDirectory, 'repository');
  const targetWorktreePath = path.join(temporaryDirectory, 'new-worktree');

  try {
    fs.mkdirSync(repositoryPath);
    git(repositoryPath, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryPath, ['config', 'user.name', 'Agenza Tests']);
    git(repositoryPath, ['config', 'user.email', 'tests@agenza.local']);
    fs.writeFileSync(path.join(repositoryPath, 'README.md'), '# fixture\n', 'utf8');
    git(repositoryPath, ['add', 'README.md']);
    git(repositoryPath, ['commit', '--quiet', '-m', 'fixture']);
    git(repositoryPath, ['branch', 'available']);

    const beforeBranches = git(repositoryPath, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
    ]);
    const beforeWorktrees = git(repositoryPath, ['worktree', 'list', '--porcelain']);
    const planner = new GitWorkspacePlanner({
      now: () => '2026-08-09T16:00:00.000Z',
      operationIdFactory: () => 'operation-11111111-1111-4111-8111-111111111111',
    });
    const preview = await planner.plan({
      projectPath: repositoryPath,
      request: {
        baseBranch: 'main',
        targetBranch: 'feature/isolated-agent',
        type: GIT_PLAN_TYPES.createNewBranch,
        worktreePath: targetWorktreePath,
      },
      terminalId: 'terminal-11111111-1111-4111-8111-111111111111',
    });
    const afterBranches = git(repositoryPath, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
    ]);
    const afterWorktrees = git(repositoryPath, ['worktree', 'list', '--porcelain']);

    assert.deepEqual(preview, {
      baseBranch: 'main',
      baseBranchRef: 'refs/heads/main',
      baseRevision: git(repositoryPath, ['rev-parse', 'main']).trim(),
      createdAt: '2026-08-09T16:00:00.000Z',
      operationId: 'operation-11111111-1111-4111-8111-111111111111',
      repositoryRoot: path.resolve(repositoryPath),
      state: 'previewed',
      targetBranch: 'feature/isolated-agent',
      targetBranchRef: 'refs/heads/feature/isolated-agent',
      targetRevision: null,
      terminalId: 'terminal-11111111-1111-4111-8111-111111111111',
      type: GIT_PLAN_TYPES.createNewBranch,
      validationFingerprint: preview.validationFingerprint,
      worktreePath: path.resolve(targetWorktreePath),
    });
    assert.match(preview.validationFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(Object.isFrozen(preview), true);
    assert.equal(planner.getPreview(preview.operationId, preview.terminalId), preview);
    assert.equal(planner.getPreview(preview.operationId, 'terminal-other'), null);
    assert.equal(beforeBranches, afterBranches);
    assert.equal(beforeWorktrees, afterWorktrees);
    assert.equal(fs.existsSync(targetWorktreePath), false);
    planner.clearPreviews();
    assert.equal(planner.getPreview(preview.operationId, preview.terminalId), null);
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('uses Git validation and detects branch, worktree, assignment, and filesystem conflicts', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'agenza-git-conflicts-'));
  const repositoryPath = path.join(temporaryDirectory, 'repository');
  const checkedOutPath = path.join(temporaryDirectory, 'checked-out');
  const availableTarget = path.join(temporaryDirectory, 'available-target');
  const assignedTarget = path.join(temporaryDirectory, 'assigned-target');
  const existingTarget = path.join(temporaryDirectory, 'existing-target');

  try {
    fs.mkdirSync(repositoryPath);
    git(repositoryPath, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryPath, ['config', 'user.name', 'Agenza Tests']);
    git(repositoryPath, ['config', 'user.email', 'tests@agenza.local']);
    fs.writeFileSync(path.join(repositoryPath, 'fixture.txt'), 'fixture\n', 'utf8');
    git(repositoryPath, ['add', 'fixture.txt']);
    git(repositoryPath, ['commit', '--quiet', '-m', 'fixture']);
    git(repositoryPath, ['branch', 'available']);
    git(repositoryPath, ['branch', 'checked-out']);
    git(repositoryPath, ['worktree', 'add', '--quiet', checkedOutPath, 'checked-out']);
    fs.mkdirSync(existingTarget);

    const planner = new GitWorkspacePlanner();
    const common = {
      projectPath: repositoryPath,
      terminalId: 'terminal-11111111-1111-4111-8111-111111111111',
    };

    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          baseBranch: 'main',
          targetBranch: 'invalid branch',
          type: GIT_PLAN_TYPES.createNewBranch,
          worktreePath: availableTarget,
        },
      }),
      GIT_PLAN_ERROR_CODES.invalidBranch,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          baseBranch: 'main',
          targetBranch: 'available',
          type: GIT_PLAN_TYPES.createNewBranch,
          worktreePath: availableTarget,
        },
      }),
      GIT_PLAN_ERROR_CODES.branchExists,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          baseBranch: 'missing-base',
          targetBranch: 'new-agent',
          type: GIT_PLAN_TYPES.createNewBranch,
          worktreePath: availableTarget,
        },
      }),
      GIT_PLAN_ERROR_CODES.baseBranchMissing,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          targetBranch: 'missing-target',
          type: GIT_PLAN_TYPES.createExistingBranch,
          worktreePath: availableTarget,
        },
      }),
      GIT_PLAN_ERROR_CODES.branchMissing,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          targetBranch: 'checked-out',
          type: GIT_PLAN_TYPES.createExistingBranch,
          worktreePath: availableTarget,
        },
      }),
      GIT_PLAN_ERROR_CODES.branchCheckedOut,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          targetBranch: 'available',
          type: GIT_PLAN_TYPES.createExistingBranch,
          worktreePath: repositoryPath,
        },
      }),
      GIT_PLAN_ERROR_CODES.pathRegistered,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          targetBranch: 'available',
          type: GIT_PLAN_TYPES.createExistingBranch,
          worktreePath: path.join(repositoryPath, 'nested-worktree'),
        },
      }),
      GIT_PLAN_ERROR_CODES.pathInsideWorktree,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        assignedWorktrees: [{ path: assignedTarget, terminalId: 'terminal-other' }],
        request: {
          targetBranch: 'available',
          type: GIT_PLAN_TYPES.createExistingBranch,
          worktreePath: assignedTarget,
        },
      }),
      GIT_PLAN_ERROR_CODES.pathAssigned,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          targetBranch: 'available',
          type: GIT_PLAN_TYPES.createExistingBranch,
          worktreePath: existingTarget,
        },
      }),
      GIT_PLAN_ERROR_CODES.pathExists,
    );
    await assertPlanError(
      planner.plan({
        ...common,
        request: {
          targetBranch: 'available',
          type: GIT_PLAN_TYPES.createExistingBranch,
          worktreePath: path.join(temporaryDirectory, 'missing-parent', 'target'),
        },
      }),
      GIT_PLAN_ERROR_CODES.parentUnavailable,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test('previews eligible existing worktrees and refuses unsupported or stale states', async () => {
  const root = 'C:\\repo';
  const attachedPath = 'C:\\repo-agent';
  const baseDiscovery = {
    branches: [
      {
        head: '1111111111111111111111111111111111111111',
        name: 'main',
        ref: 'refs/heads/main',
        worktreePath: root,
      },
      {
        head: '2222222222222222222222222222222222222222',
        name: 'agent',
        ref: 'refs/heads/agent',
        worktreePath: attachedPath,
      },
    ],
    currentWorktree: {
      bare: false,
      branch: 'main',
      branchRef: 'refs/heads/main',
      detached: false,
      head: '1111111111111111111111111111111111111111',
      locked: false,
      path: root,
      prunable: false,
    },
    root,
    worktrees: [
      {
        bare: false,
        branch: 'main',
        branchRef: 'refs/heads/main',
        detached: false,
        head: '1111111111111111111111111111111111111111',
        locked: false,
        path: root,
        prunable: false,
      },
      {
        bare: false,
        branch: 'agent',
        branchRef: 'refs/heads/agent',
        detached: false,
        head: '2222222222222222222222222222222222222222',
        locked: false,
        path: attachedPath,
        prunable: false,
      },
    ],
  };
  let discovery = clone(baseDiscovery);
  const planner = new GitWorkspacePlanner({
    discover: async () => discovery,
    fileSystem: {
      access: async () => undefined,
      stat: async () => ({ isDirectory: () => true }),
    },
    operationIdFactory: () => 'operation-existing',
  });
  const request = {
    type: GIT_PLAN_TYPES.attachWorktree,
    worktreePath: attachedPath,
  };
  const common = {
    projectPath: root,
    request,
    terminalId: 'terminal-11111111-1111-4111-8111-111111111111',
  };
  const preview = await planner.plan(common);

  assert.equal(preview.targetBranch, 'agent');
  assert.equal(preview.worktreePath, path.resolve(attachedPath));

  discovery = clone(baseDiscovery);
  discovery.worktrees[1].locked = true;
  await assertPlanError(planner.plan(common), GIT_PLAN_ERROR_CODES.worktreeLocked);

  discovery = clone(baseDiscovery);
  discovery.worktrees[1].prunable = true;
  await assertPlanError(planner.plan(common), GIT_PLAN_ERROR_CODES.worktreePrunable);

  discovery = clone(baseDiscovery);
  discovery.worktrees[1].detached = true;
  discovery.worktrees[1].branch = null;
  discovery.worktrees[1].branchRef = null;
  await assertPlanError(planner.plan(common), GIT_PLAN_ERROR_CODES.worktreeDetached);

  discovery = clone(baseDiscovery);
  discovery.currentWorktree.head = '0000000000000000000000000000000000000000';
  await assertPlanError(planner.plan(common), GIT_PLAN_ERROR_CODES.repositoryUnsupported);
});
