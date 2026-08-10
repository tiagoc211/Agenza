# Agenza 0.2.0 scope and workspace safety

## Objective

Agenza `0.2.0` turns the fixed two-pane `0.1.0` workspace into a dynamic local manager for Codex
terminals. A user can add or remove terminal panes and optionally assign each pane to an isolated Git
branch and worktree so multiple agents can work on the same repository without sharing a working
directory.

The release remains Windows-only, local-only, single-user, and Codex-only. A terminal may still use
an ordinary project folder without Git; Git workspace management is optional.

## Terms and ownership

- A **terminal definition** is the saved pane identity, label, order, and workspace assignment.
- A **terminal session** is the running Codex PTY process tree for one terminal definition.
- A **Git workspace** is a repository branch checked out at a worktree path and assigned to a
  terminal.
- An **Agenza-created worktree** is a worktree that Agenza created and recorded with ownership
  metadata. Discovery or attachment does not make an existing worktree owned by Agenza.
- A **branch** is repository data independent from both a terminal and its worktree directory.

Ownership metadata allows Agenza to decide which worktrees it may offer to clean up. It never gives
Agenza ownership of a branch.

## User workflows

### Add a terminal

1. The user chooses **Add terminal**.
2. Agenza creates a new pane with a stable ID and user-facing label but does not mutate Git.
3. The user chooses one workspace assignment:
   - use an ordinary project folder;
   - attach a registered existing worktree;
   - create a worktree for an eligible existing local branch; or
   - create a new local branch and its worktree from a selected base branch.
4. Agenza previews and validates any proposed Git mutation before asking for confirmation.
5. Codex starts in the assigned folder or worktree only after the assignment succeeds.

Canceling or failing this flow leaves the new pane unassigned and does not change the repository or
any other terminal.

### Remove a terminal

1. The user chooses **Remove terminal** on one pane and confirms the terminal-only action.
2. Agenza terminates that terminal's complete Codex process tree.
3. Agenza removes the pane and its saved terminal definition.
4. The assigned folder, worktree registration, worktree directory, and branch remain unchanged.

The interface must explicitly state that removing a terminal does not delete Git work.

### Assign or change a Git workspace

1. The user selects a repository and chooses a new branch, eligible existing branch, or existing
   worktree.
2. Agenza shows the repository root, base branch when relevant, target branch, and target worktree
   path.
3. Read-only checks detect invalid names, duplicate paths, branches already checked out elsewhere,
   missing repositories, and unsupported states.
4. After explicit confirmation, Agenza performs only the selected local operation.
5. A successful assignment restarts only that terminal in the resulting worktree.

Changing an assignment never cleans up the previous worktree automatically.

### Clean up an Agenza-created worktree

1. Cleanup is offered separately from terminal removal and only for a worktree recorded as created
   by Agenza.
2. The worktree must not be assigned to a terminal and must still be registered, present, unlocked,
   and free of tracked, untracked, or conflicted changes.
3. Agenza shows the exact worktree path and branch before asking for explicit confirmation.
4. Agenza runs a normal, non-forced worktree removal.
5. The local branch remains in the repository after successful cleanup.

If any safety check fails, Agenza refuses cleanup and explains how the user can inspect or preserve
the work outside the app. If Git proves a recorded Agenza worktree is no longer registered, the
user may explicitly forget that stale local ownership record. Forgetting it changes neither Git
metadata, files, worktrees, nor branches.

## Separate lifecycle operations

| Operation                     | Codex process                | Saved terminal   | Worktree directory and registration | Branch                      |
| ----------------------------- | ---------------------------- | ---------------- | ----------------------------------- | --------------------------- |
| Restart terminal              | Replaced                     | Preserved        | Preserved                           | Preserved                   |
| Remove terminal               | Terminated                   | Removed          | Preserved                           | Preserved                   |
| Change assignment             | Restarted after success      | Updated          | Previous workspace preserved        | Preserved                   |
| Clean Agenza-created worktree | Must already be stopped      | Already detached | Removed only after safety checks    | Preserved                   |
| Delete branch                 | No Agenza operation in 0.2.0 | Preserved        | Preserved                           | User manages outside Agenza |

No single control may combine terminal removal, worktree cleanup, or branch deletion.

## Safety rules

- Startup, restore, discovery, refresh, and status checks are read-only Git operations.
- Every local Git mutation has a preview, validation, and explicit confirmation step.
- Agenza does not use forced worktree removal in `0.2.0`.
- Dirty, untracked, conflicted, locked, missing, or actively assigned worktrees are never removed.
- Worktrees not recorded as created by Agenza can be attached or detached but not deleted by Agenza.
- Branches are never deleted automatically, including after worktree cleanup.
- A partial failure rolls back only resources created by that failed operation and never modifies
  pre-existing branches or worktrees to make the rollback succeed.
- A terminal or Git failure is isolated to the affected pane and cannot stop other Codex sessions.
- Terminal input, output, Git credentials, environment values, and secret-bearing commands are not
  stored in persisted state or logs.
- Closing Agenza terminates all Codex process trees but preserves every Git workspace.

## Out of scope for 0.2.0

- Automatic merge, rebase, cherry-pick, conflict resolution, commit, push, pull, or fetch workflows.
- Branch deletion or automatic branch cleanup.
- Communication, orchestration, or task delegation between Codex agents.
- CLI tools other than Codex.
- Remote repository creation, authentication, credential management, or hosting-provider features.
- Shared multi-user workspaces, Agenza accounts, cloud synchronization, or remote terminal sessions.
- macOS, Linux, web, and mobile versions.

Users may perform out-of-scope Git operations in a normal terminal or another Git client. Agenza
must detect resulting stale state safely on its next restore or refresh rather than trying to repair
Git data silently.

## Release success

The release is successful when users can restore zero, one, two, or several terminal definitions;
run two Codex agents in different worktrees of the same repository; remove terminals without losing
Git work; safely clean eligible Agenza-created worktrees; and close the app without orphaned
processes or automatic Git mutations.
