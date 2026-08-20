# Agenza 0.2.0

Agenza `0.2.0` turns the original fixed two-terminal window into a dynamic local workspace for
independent Codex CLI sessions. Each terminal can use an ordinary folder or an isolated Git branch
and worktree, so multiple agents can work in one repository without sharing a working directory.

## Highlights

- Add or remove terminal panes and restore zero, one, two, or several panes across launches.
- Create a new local branch and worktree for one terminal after reviewing the exact operation.
- Create a worktree for an eligible existing branch or attach a registered existing worktree.
- See each terminal's repository, branch, worktree, and tracked, untracked, or conflicted change
  counts.
- Remove a terminal without deleting its project directory, worktree, Git registration, or branch.
- Clean only eligible unassigned worktrees created by Agenza, using guarded non-forced removal.
- Recover safely when repositories, branches, or worktrees are moved or removed outside Agenza.
- Keep keyboard focus, controls, process state, output, and failures isolated per terminal.

## Install or upgrade

1. Close every running Agenza window.
2. Download `Agenza-0.2.0 Setup.exe` from this release.
3. Run the installer and open Agenza.

The installer upgrades `0.1.0` using the same Squirrel application identity. Release `0.1.0` did not
persist terminal layouts, so the first `0.2.0` launch creates two unassigned panes. Existing project
folders, repositories, branches, worktrees, and Git files remain untouched.

Windows may show a SmartScreen warning because the installer is not digitally signed. Only run the
installer downloaded from the official Agenza GitHub Release.

## Requirements

- Windows 10 version 1809 or newer, or Windows 11.
- Codex CLI installed and authenticated, with `codex --version` working in a normal terminal.
- Git available with `git --version` for Git workspace features. Ordinary folders do not require
  Git.

Conda, Node.js, and npm are not required to run the installed application.

## Git workspace workflow

Choose a repository folder in a terminal, then open **Git workspace**. Agenza can:

- create a new local branch and worktree from a selected base revision;
- create a worktree for an eligible existing local branch; or
- attach a registered existing worktree without recreating or claiming ownership of it.

Every mutation shows a preview and repeats validation at confirmation. Agenza refuses conflicting
branch names, existing or assigned paths, branches checked out elsewhere, unsupported repository
states, and repository changes made after the preview.

## Removal, cleanup, and recovery safety

Terminal removal stops only that terminal's complete Codex process tree and removes only its saved
pane. It never deletes project files, a worktree, its registration, or its branch.

Worktree cleanup is a separate confirmed action available only for unassigned worktrees recorded as
created by Agenza. Cleanup is refused if a worktree is assigned, dirty, untracked, conflicted,
locked, missing, ambiguous, or externally owned. Successful cleanup removes the worktree without
force and preserves the branch.

When saved Git metadata becomes stale, Agenza offers a normal previewed reassignment or a
metadata-only detach. It does not silently prune Git metadata. Assigned, ambiguous, registered, and
temporarily inaccessible ownership records are preserved.

## Privacy and diagnostics

Agenza stores its versioned layout under `%APPDATA%\Agenza` and writes sanitized diagnostics to
`%APPDATA%\Agenza\logs\agenza.log`. Persisted state and logs never contain terminal input or output,
Codex prompts or responses, commands, credentials, environment values, repository paths, branch or
file names, Git output, or remote URLs.

## Release verification

The `0.2.0` release gate passed the complete unit and integration suite, a fresh Windows package
build, and a packaged dynamic-workspace smoke test. The smoke test covers dynamic layouts, isolated
temporary Git worktrees, persistence and restore, terminal removal, cleanup catalog reconciliation,
focus, complete process-tree shutdown, and orphan detection. Release validation also checks the
Squirrel installer, package manifest, application archive, native ConPTY runtime, and the
executable's embedded `0.2.0` product version.

## Known limitations

- Windows only and Codex is the only supported CLI.
- Sessions do not communicate, link, delegate, or orchestrate each other.
- Agenza does not merge, rebase, commit, resolve conflicts, fetch, pull, push, manage remotes, or
  delete branches.
- Forced worktree cleanup and cleanup of attached external worktrees are unavailable.
- No accounts, multi-user workspaces, cloud synchronization, remote terminals, automatic updates,
  or code signing.

See [README.md](../README.md) for complete usage, safety, recovery, and troubleshooting guidance,
and [CHANGELOG.md](../CHANGELOG.md) for the full change summary.
