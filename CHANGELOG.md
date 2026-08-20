# Changelog

All notable changes to Agenza are documented in this file.

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
[0.1.0]: https://github.com/tiagoc211/Agenza/releases/tag/v0.1.0
