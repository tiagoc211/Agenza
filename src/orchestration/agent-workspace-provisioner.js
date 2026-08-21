const path = require('node:path');

const { discoverGitRepository } = require('../git/git-discovery');
const { GitWorkspaceExecutor } = require('../git/git-workspace-executor');
const { GIT_PLAN_TYPES, GitWorkspacePlanner } = require('../git/git-workspace-planner');

const slugify = (value, fallback = 'task') =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || fallback;

class AgentWorkspaceProvisioner {
  constructor({
    discover = discoverGitRepository,
    executor = null,
    pathModule = path,
    planner = null,
    workspaceService,
  } = {}) {
    if (!workspaceService || typeof discover !== 'function') {
      throw new TypeError('Agent workspace provisioning requires workspace and Git discovery.');
    }
    this._discover = discover;
    this._path = pathModule;
    this._workspaceService = workspaceService;
    this._planner = planner ?? new GitWorkspacePlanner({ discover, pathModule });
    this._executor = executor ?? new GitWorkspaceExecutor({ discover, planner: this._planner });
  }

  async resolveProject(sourceTerminalId) {
    if (typeof sourceTerminalId !== 'string' || !this._workspaceService.has(sourceTerminalId)) {
      throw new Error('Select a valid project terminal before starting orchestration.');
    }
    const projectPath = this._workspaceService.getCurrentFolder(sourceTerminalId);
    if (!projectPath) {
      throw new Error('The selected terminal must have an accessible project workspace.');
    }
    const repository = await this._discover(projectPath);
    if (
      !repository.currentBranch ||
      !repository.currentBranchRef ||
      !repository.currentWorktree?.head ||
      repository.currentWorktree.detached ||
      repository.currentWorktree.locked ||
      repository.currentWorktree.prunable
    ) {
      throw new Error('The selected project must be on a supported local branch and worktree.');
    }
    return Object.freeze({
      sourceTerminalId,
      projectPath,
      repositoryRoot: repository.root,
      baseBranch: repository.currentBranch,
      baseBranchRef: repository.currentBranchRef,
      baseRevision: repository.currentWorktree.head,
    });
  }

  async provision({ orchestrationId, project, task }) {
    const terminal = await this._workspaceService.create();
    const shortRun = orchestrationId.replace('orchestration-', '').slice(0, 8);
    const taskSlug = slugify(task.planKey || task.title);
    const branch = `agenza/${shortRun}/${taskSlug}`;
    const repositoryName = slugify(this._path.basename(project.repositoryRoot), 'repository');
    const worktreePath = this._path.join(
      this._path.dirname(project.repositoryRoot),
      `${repositoryName}-agenza-${shortRun}-${taskSlug}`,
    );

    try {
      const preview = await this._planner.plan({
        assignedWorktrees: this._workspaceService.getAssignedGitWorktrees(terminal.id),
        projectPath: project.projectPath,
        request: {
          type: GIT_PLAN_TYPES.createNewBranch,
          baseBranch: project.baseBranch,
          targetBranch: branch,
          worktreePath,
        },
        terminalId: terminal.id,
      });
      const operation = await this._executor.createNewBranch({
        assignedWorktrees: this._workspaceService.getAssignedGitWorktrees(terminal.id),
        commitAssignment: (workspace) =>
          this._workspaceService.assignGitWorktree(terminal.id, workspace),
        getAssignedWorktrees: () => this._workspaceService.getAssignedGitWorktrees(terminal.id),
        operationId: preview.operationId,
        projectPath: project.projectPath,
        terminalId: terminal.id,
      });
      return Object.freeze({
        branch,
        terminalId: terminal.id,
        worktreeId: operation.workspace.repository.worktree.ownership.creationId,
        worktreePath: operation.workspace.projectPath,
      });
    } catch (error) {
      try {
        await this._workspaceService.remove(terminal.id);
      } catch {
        // Preserve the provisioning error; failed Git transactions already guard their resources.
      }
      throw error;
    }
  }

  enqueueRepository(repositoryRoot, operation) {
    if (typeof repositoryRoot !== 'string' || typeof operation !== 'function') {
      throw new TypeError('A repository queue requires a root and operation.');
    }
    return this._executor.enqueueRepository(repositoryRoot, operation);
  }

  dispose() {
    this._planner.clearPreviews?.();
  }
}

module.exports = { AgentWorkspaceProvisioner, slugify };
