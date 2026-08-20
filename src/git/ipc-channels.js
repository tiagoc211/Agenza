const GIT_CHANNELS = Object.freeze({
  attachWorktree: 'agenza:git:attach-worktree',
  createExistingBranch: 'agenza:git:create-existing-branch',
  createNewBranch: 'agenza:git:create-new-branch',
  confirmCleanup: 'agenza:git:confirm-worktree-cleanup',
  discover: 'agenza:git:discover',
  listManagedWorktrees: 'agenza:git:list-managed-worktrees',
  previewCleanup: 'agenza:git:preview-worktree-cleanup',
  planWorkspace: 'agenza:git:plan-workspace',
  status: 'agenza:git:status',
});

module.exports = { GIT_CHANNELS };
