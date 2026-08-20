const DEFAULT_GIT_RECOVERY =
  'Retry this action. If it fails again, inspect this terminal workspace with Git in a normal terminal.';

const GIT_RECOVERY_ACTIONS = Object.freeze({
  BASE_BRANCH_NOT_FOUND: 'Refresh the repository, then choose an existing local base branch.',
  BRANCH_ALREADY_CHECKED_OUT:
    'Attach the registered worktree for that branch or choose a different branch.',
  GIT_COMMAND_FAILED:
    'Retry once. If it fails again, inspect this terminal workspace with Git in a normal terminal.',
  GIT_NOT_FOUND: 'Install Git on the system PATH, then fully restart Agenza.',
  GIT_OUTPUT_LIMIT:
    'Inspect the repository in a normal terminal; Agenza stopped reading before applying any change.',
  GIT_TIMEOUT:
    'Retry once. If it times out again, inspect the repository in a normal terminal before continuing.',
  GIT_WORKSPACE_ASSIGN_FAILED:
    'Review the current workspace assignment and retry; no pre-existing Git work was removed.',
  GIT_WORKSPACE_CREATE_FAILED:
    'Refresh and review the operation again; no pre-existing Git work was removed.',
  GIT_WORKSPACE_REFRESH_FAILED:
    'Retry Refresh Git. If it fails again, detach or reassign this terminal workspace.',
  GIT_WORKSPACE_MANUAL_RECOVERY:
    'Do not retry automatically. Inspect the previewed branch and worktree in a normal terminal.',
  GIT_WORKSPACE_VERIFICATION_FAILED:
    'Inspect the previewed worktree in a normal terminal, then refresh Agenza before retrying.',
  INVALID_BRANCH_NAME: 'Edit the branch name, then review the operation again.',
  INVALID_GIT_REQUEST: 'Close and reopen this workspace action, then try again.',
  INVALID_WORKSPACE_CONFIRMATION: 'Review the Git operation again before confirming it.',
  INVALID_WORKSPACE_PLAN: 'Close and reopen the Git workspace dialog, then review the operation.',
  INVALID_WORKTREE_CLEANUP_REQUEST: 'Choose a recorded Agenza-created worktree and check it again.',
  INVALID_WORKTREE_PATH: 'Choose another absolute worktree path, then review the operation.',
  NOT_GIT_REPOSITORY: 'Choose a folder inside a Git repository or initialize Git outside Agenza.',
  PROJECT_FOLDER_UNAVAILABLE: 'Choose an accessible project folder for this terminal.',
  SAVED_GIT_BRANCH_MISSING:
    'Restore and reassign the branch, or detach this terminal workspace without deleting Git data.',
  SAVED_GIT_INSPECTION_FAILED:
    'Retry Refresh Git, or detach this terminal workspace if the repository remains unavailable.',
  SAVED_GIT_REPOSITORY_CHANGED:
    'Review the current repository and reassign it, or detach the saved terminal workspace.',
  SAVED_GIT_REPOSITORY_MISSING:
    'Restore the repository, choose another folder, or detach the saved terminal workspace.',
  SAVED_GIT_WORKTREE_BRANCH_CHANGED:
    'Review and reassign the current branch, or detach the saved terminal workspace.',
  SAVED_GIT_WORKTREE_MISSING:
    'Restore or reassign the worktree, or detach the saved terminal workspace.',
  SAVED_GIT_WORKTREE_MOVED: 'Use Reassign Git to review the registered path before starting Codex.',
  SAVED_GIT_WORKTREE_PRUNABLE:
    'Inspect the stale registration outside Agenza; Agenza will not prune it automatically.',
  TARGET_BRANCH_ALREADY_EXISTS:
    'Use the existing-branch flow or choose a different new branch name.',
  TARGET_BRANCH_NOT_FOUND: 'Refresh the repository, then choose an existing local branch.',
  TERMINAL_START_FAILED: 'Use Restart after verifying that Codex works in a normal terminal.',
  UNEXPECTED_GIT_OUTPUT:
    'Inspect the repository in a normal terminal; Agenza refused the unfamiliar output safely.',
  UNSUPPORTED_REPOSITORY_STATE:
    'Inspect the repository state in a normal terminal and choose a supported local branch.',
  WORKSPACE_PREVIEW_EXPIRED: 'Review the operation again to create a fresh confirmation.',
  WORKSPACE_PREVIEW_STALE: 'Refresh and review the updated repository details before confirming.',
  WORKTREE_CLEANUP_ASSIGNED: 'Remove or reassign the terminal first, then check cleanup again.',
  WORKTREE_CLEANUP_CATALOG_SYNC_FAILED:
    'Git removed the worktree and kept its branch. Reopen Clean worktrees so Agenza can reconcile the local catalog automatically.',
  WORKTREE_CLEANUP_CONFLICTED:
    'Resolve and preserve the conflicted files outside Agenza, then check cleanup again.',
  WORKTREE_CLEANUP_DIRTY:
    'Commit, stash, or discard tracked changes outside Agenza, then check cleanup again.',
  WORKTREE_CLEANUP_LOCKED: 'Unlock and inspect the worktree outside Agenza before retrying.',
  WORKTREE_CLEANUP_MISSING:
    'Retry Clean worktrees. Agenza preserves the local record unless Git confirms that its registration is gone.',
  WORKTREE_CLEANUP_MOVED:
    'Reopen Clean worktrees to sync an unassigned moved path, or reassign it through its terminal recovery flow.',
  WORKTREE_CLEANUP_NOT_OWNED: 'Choose a worktree that Agenza created and recorded.',
  WORKTREE_CLEANUP_PREVIEW_EXPIRED: 'Run Check safety again before confirming cleanup.',
  WORKTREE_CLEANUP_PREVIEW_STALE:
    'Review the changed worktree and run Check safety again before confirming.',
  WORKTREE_CLEANUP_PRUNABLE:
    'Inspect the stale registration outside Agenza; Agenza will not prune it automatically.',
  WORKTREE_CLEANUP_REMOVE_FAILED:
    'Inspect the worktree outside Agenza; no forced removal was attempted.',
  WORKTREE_CLEANUP_STALE_RECORD_NOT_CONFIRMED:
    'The worktree is still registered, so keep the local record and use the normal cleanup flow.',
  WORKTREE_CLEANUP_UNTRACKED:
    'Move, commit, or remove untracked files outside Agenza, then check cleanup again.',
  WORKTREE_CLEANUP_VERIFICATION_FAILED:
    'Inspect the worktree registration outside Agenza before attempting another cleanup.',
  WORKTREE_DETACHED: 'Choose a worktree attached to a local branch.',
  WORKTREE_LOCKED: 'Unlock and inspect the worktree outside Agenza before assigning it.',
  WORKTREE_NOT_REGISTERED: 'Refresh Git and choose a currently registered worktree.',
  WORKTREE_PARENT_UNAVAILABLE: 'Choose an existing writable parent folder for the new worktree.',
  WORKTREE_PATH_ASSIGNED: 'Choose a worktree that is not assigned to another terminal.',
  WORKTREE_PATH_EXISTS: 'Choose a new path that does not already exist on disk.',
  WORKTREE_PATH_INSIDE_WORKTREE: 'Choose a sibling path outside every registered worktree.',
  WORKTREE_PATH_REGISTERED: 'Attach the registered worktree or choose a different new path.',
  WORKTREE_PRUNABLE:
    'Inspect the stale registration outside Agenza; Agenza will not prune it automatically.',
});

const getGitRecoveryAction = (code, fallback = DEFAULT_GIT_RECOVERY) =>
  GIT_RECOVERY_ACTIONS[code] ?? fallback;

const addGitRecovery = (errorPayload, fallback) =>
  Object.freeze({
    ...errorPayload,
    recovery: getGitRecoveryAction(errorPayload?.code, fallback),
  });

module.exports = {
  DEFAULT_GIT_RECOVERY,
  GIT_RECOVERY_ACTIONS,
  addGitRecovery,
  getGitRecoveryAction,
};
