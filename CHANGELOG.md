# Changelog

All notable changes to Agenza are documented in this file.

## [0.3.0] - 2026-08-21

- Require explicit project-workspace selection before revealing or enabling orchestration controls.

### Added

- Persistent orchestrations, dependency-aware tasks, logical agents, provider runtimes, structured
  results, and review-ready integration state.
- A provider registry and Codex App Server adapter using JSON-RPC threads, turns, items, structured
  planner output, interruption, and lifecycle events.
- Safe automatic provisioning of one terminal definition, local branch, and isolated managed
  worktree per implementation agent through the existing Git transaction layer.
- Consistent orchestrator and worker prompt contracts with explicit roles, ownership, constraints,
  acceptance criteria, and completion reporting.
- Narrow start, list, stop, and event IPC plus a minimal goal, limit, task, agent, status, and
  workspace-focus interface.
- Separate atomic orchestration persistence and stopped-state recovery for interrupted runs.
- A persistent Workspaces sidebar with project-scoped terminal creation and navigation.

### Safety

- The renderer supplies only a goal, validated options, and an opaque project-workspace ID; the
  main process resolves the repository and computes every branch and worktree path.
- Worktree planning and creation are serialized per repository while agent execution remains
  concurrent.
- Worker lifecycle is no longer controlled by writing instructions into PTYs.
- Planner turns are read-only; worker turns are scoped to one worktree with network disabled.
- Automatic merge, branch deletion, worktree cleanup, push, pull, fetch, rebase, and cherry-pick
  remain unavailable. Completed worktrees are preserved for review.

### Known limitations

- Codex is the only provider, one run has at most four tasks, and nested agents are disabled.
- Dependencies schedule work but do not transfer commits between branches.
- The associated terminal is a workspace view rather than a TUI attached to the agent thread.

## [0.2.0] - 2026-08-20

### Added

- Dynamic terminal panes that can be added or removed, including usable zero-, one-, two-, and
  multi-pane layouts.
- Versioned local persistence for terminal IDs, stable labels, display order, active pane, ordinary
  folders, Git assignments, and Agenza-created worktree ownership.
- Read-only Git repository, branch, registered-worktree, and working-tree status discovery.
- Previewed and confirmed workflows to create a new branch worktree, create a worktree for an
  eligible existing local branch, or attach an existing registered worktree.
- Per-terminal repository, branch, worktree, and tracked, untracked, or conflicted change summaries.
- Separate guarded cleanup for unassigned clean worktrees created by Agenza, without branch
  deletion.
- Recovery for moved, missing, or otherwise stale repositories, branches, and worktrees through
  safe reassignment or metadata-only detach.
- Accessible dynamic-pane focus cycling, dialog focus management, action names, visible focus
  states, and live status announcements.
- Git lifecycle diagnostics that contain only allowlisted, sanitized metadata and hashed
  correlators.
- Automated temporary-repository coverage, packaged dynamic-workspace smoke testing, stale catalog
  reconciliation, upgrade-state regression checks, and executable-version validation.

### Changed

- Terminal sessions use generated stable IDs instead of two fixed process identifiers.
- Later launches restore the saved terminal layout; a first `0.2.0` launch starts with two
  unassigned panes for a familiar upgrade experience.
- Removing a terminal now explicitly removes only its process tree and saved pane while preserving
  its folder, worktree, Git registration, branch, and Agenza ownership record.
- Multiple repository mutations are serialized per repository while unrelated terminals and
  repositories remain independent.
- The Windows installer, application executable, package metadata, and lockfile now use version
  `0.2.0` while retaining the `agenza` Squirrel upgrade identity.

### Safety

- Every Git mutation requires a fresh preview, validation, and explicit confirmation.
- Dirty, untracked, conflicted, locked, missing, assigned, ambiguous, or externally owned worktrees
  are preserved instead of being force-removed.
- Agenza never deletes branches, automatically prunes worktrees, or performs merge, rebase, commit,
  fetch, pull, or push operations.
- Startup, restore, refresh, status, and catalog reconciliation do not mutate Git data.
- Closing or restarting Agenza terminates complete Codex process trees without deleting Git work.

### Known limitations

- Windows only and Codex is the only supported CLI.
- Sessions are independent and cannot communicate or orchestrate each other.
- Git hosting, remote operations, branch deletion, forced cleanup, accounts, cloud synchronization,
  automatic updates, and code signing remain unavailable.

## [0.1.0] - 2026-08-09

### Added

- Windows Electron application with two independent embedded Codex terminal panes.
- Independent project-folder selection, restart, clear, copy, and paste controls for each pane.
- Keyboard focus switching with `F6` and `Shift+F6` plus terminal-safe clipboard shortcuts.
- Secure Electron boundaries with sandboxed rendering, context isolation, validated IPC, and no
  renderer Node.js integration.
- Full process-tree cleanup on restart and application shutdown.
- Local structured diagnostics that exclude terminal content, commands, environment variables, and
  secrets.
- Unit, integration, packaged smoke, orphan-process, and release-artifact validation.
- Windows Squirrel installer and packaged application build.

### Changed

- Agenza launches the user's normal system `codex` command and does not require Conda at runtime.
- Conda environment `agenza` is retained only as the repository agent development workflow.

### Known limitations

- Windows only, with exactly two Codex-only terminal panes.
- Project-folder choices are not persisted between launches.
- Sessions cannot communicate with each other.
- The installer is not digitally signed and automatic updates are not configured.

[0.2.0]: https://github.com/tiagoc211/Agenza/releases/tag/v0.2.0
[0.3.0]: https://github.com/tiagoc211/Agenza/releases/tag/v0.3.0
[0.1.0]: https://github.com/tiagoc211/Agenza/releases/tag/v0.1.0
