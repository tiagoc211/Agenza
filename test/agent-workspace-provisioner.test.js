const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { setImmediate } = require('node:timers');

const { AgentWorkspaceProvisioner } = require('../src/orchestration/agent-workspace-provisioner');

test('serializes worktree planning and creation per repository', async () => {
  let terminalNumber = 0;
  let releaseFirst;
  let planCount = 0;
  const firstCreation = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const attached = [];
  const planner = {
    clearPreviews() {},
    plan: async ({ terminalId }) => {
      planCount += 1;
      return { operationId: `operation-${terminalId}` };
    },
  };
  const executor = {
    createNewBranch: async ({ commitAssignment, terminalId }) => {
      if (terminalId === 'terminal-1') await firstCreation;
      const workspace = {
        kind: 'git-worktree',
        projectPath: `C:\\worktrees\\${terminalId}`,
        repository: {
          root: 'C:\\project',
          branch: `refs/heads/${terminalId}`,
          worktree: {
            path: `C:\\worktrees\\${terminalId}`,
            ownership: { kind: 'agenza', creationId: `worktree-${terminalId}` },
          },
        },
      };
      await commitAssignment(workspace);
      return { workspace };
    },
    enqueueRepository: (_root, operation) => operation(),
  };
  const workspaceService = {
    assignGitWorktree: async () => undefined,
    create: async () => ({ id: `terminal-${++terminalNumber}` }),
    getAssignedGitWorktrees: () => [],
    remove: async () => undefined,
  };
  const provisioner = new AgentWorkspaceProvisioner({
    executor,
    pathModule: path.win32,
    planner,
    projectWorkspaceService: {
      attachTerminal: async (workspaceId, terminalId) => attached.push({ workspaceId, terminalId }),
      get: () => ({
        id: 'workspace-1',
        projectPath: 'C:\\project',
        status: 'available',
      }),
    },
    workspaceService,
  });
  const project = {
    projectWorkspaceId: 'workspace-1',
    projectPath: 'C:\\project',
    repositoryRoot: 'C:\\project',
    baseBranch: 'main',
  };
  const first = provisioner.provision({
    orchestrationId: 'orchestration-11111111',
    project,
    task: { planKey: 'one', title: 'One' },
  });
  const second = provisioner.provision({
    orchestrationId: 'orchestration-11111111',
    project,
    task: { planKey: 'two', title: 'Two' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(planCount, 1);
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(planCount, 2);
  assert.deepEqual(attached, [
    { workspaceId: 'workspace-1', terminalId: 'terminal-1' },
    { workspaceId: 'workspace-1', terminalId: 'terminal-2' },
  ]);
});
