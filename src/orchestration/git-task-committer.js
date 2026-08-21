const { runGit } = require('../git/git-command');
const { readGitWorkspaceStatus } = require('../git/git-status');

class GitTaskCommitter {
  constructor({ readStatus = readGitWorkspaceStatus, run = runGit } = {}) {
    if (typeof readStatus !== 'function' || typeof run !== 'function') {
      throw new TypeError('Git task committer requires bounded Git status and command access.');
    }
    this._readStatus = readStatus;
    this._run = run;
  }

  async commit({ task, worktreePath }) {
    const status = await this._readStatus(worktreePath);
    if (status.changes.conflicted > 0) {
      throw new Error('The agent worktree contains unresolved conflicts and was not committed.');
    }
    if (status.changes.isClean) {
      const head = await this._run(['rev-parse', 'HEAD'], { cwd: worktreePath });
      return Object.freeze({ commit: head.stdout.trim(), created: false });
    }
    await this._run(['add', '--all'], { cwd: worktreePath });
    await this._run(
      ['-c', 'commit.gpgsign=false', 'commit', '-m', `Agenza task: ${task.planKey}`],
      { cwd: worktreePath },
    );
    const head = await this._run(['rev-parse', 'HEAD'], { cwd: worktreePath });
    return Object.freeze({ commit: head.stdout.trim(), created: true });
  }
}

module.exports = { GitTaskCommitter };
