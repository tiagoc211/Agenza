<p align="center">
  <img src="images/agenzalogov2.png" width="140" alt="Agenza Logo">
</p>

<p align="center">
  <strong>A local workspace for running multiple AI coding agents.</strong>
</p>

<p align="center">
  Run independent Codex CLI sessions side by side, each with its own project workspace.
</p>

# Agenza

Agenza is a local Windows desktop workspace for running independent Codex CLI sessions. Release
`0.2.0` adds a dynamic terminal layout and optional Git branch/worktree isolation, allowing multiple
agents to work in the same repository without sharing a working directory.

A terminal session and a Git workspace are separate resources. Removing a terminal never deletes
its project files, worktree, or branch.

## User requirements

- Windows 10 version 1809 or newer, or Windows 11.
- An installed and authenticated Codex CLI.
- The `codex` command available in a normal terminal. Verify it with `codex --version`.
- Git available with `git --version` to use repository discovery, branch, worktree, status, cleanup,
  and recovery features. Git is not required for ordinary non-Git project folders.

Agenza runs Codex and Git from the user's normal system environment. Users do not need Conda,
Node.js, or npm to run the installed application.

## Install or upgrade

Download `Agenza-0.2.0 Setup.exe` from the Agenza `0.2.0` GitHub Release and run it. Close every
Agenza window before installing or upgrading.

The Squirrel application identity is unchanged from `0.1.0`, so the `0.2.0` installer upgrades the
existing installation. Release `0.1.0` did not persist a terminal layout; the first `0.2.0` launch
therefore starts with two unassigned terminals. Existing project directories, Git worktrees,
branches, and repository data are not changed by the upgrade.

The installer is not digitally signed, so Windows may show a SmartScreen warning. Only run an
installer downloaded from the project's own GitHub Release.

## Use Agenza

1. Open Agenza. A first launch starts with two unassigned terminal panes.
2. Choose **Choose folder** in each pane and select an ordinary project folder, or select a Git
   repository before using **Git workspace**.
3. Wait until the pane shows **Connected**, then use Codex normally.
4. Choose **Add terminal** for another independent pane or **Remove** to stop and remove one pane.
5. Close Agenza when finished; all running Codex process trees are terminated while project and Git
   work remain intact.

The saved workspace restores zero, one, two, or several terminal definitions, their stable labels,
order, active pane, and assignments. Restored accessible folders are shown without automatically
starting Codex; use **Start** when you want to connect that terminal. A missing restored path is
reported only in its affected pane and can be reassigned or detached safely.

Each pane provides:

- **Choose folder** or **Change folder** to assign an ordinary directory and start or restart only
  that terminal.
- **Git workspace** to preview a new branch worktree, an eligible existing-branch worktree, or an
  existing registered worktree.
- **Copy**, **Paste**, **Clear**, and **Restart** (or **Start** after restore), scoped to that
  terminal.
- **Refresh Git** to show repository, branch, worktree, and tracked, untracked, or conflicted change
  counts without exposing file names.
- **Remove** to stop that terminal's complete process tree and remove only its saved pane.

### Create a new branch and worktree

1. Use **Choose folder** to select a folder inside the source repository.
2. Choose **Git workspace** and select **Create a new branch**.
3. Select the base branch and enter a new local branch name and new worktree path.
4. Review the repository, exact base revision, target branch, and path shown in the preview.
5. Confirm the operation. Agenza creates the local branch and worktree, assigns them only to that
   terminal, and starts Codex in the new worktree.

Branch-name conflicts, paths that already exist, branches checked out elsewhere, locked or
unsupported worktrees, and repository changes after preview are refused without mutation.

### Use an existing branch or worktree

Open **Git workspace** after choosing the repository, then select one of these assignments:

- **Use an existing local branch** creates a new worktree for an eligible branch after preview and
  confirmation. It does not create or delete the branch.
- **Attach a registered worktree** assigns an existing Git worktree without recreating it or taking
  Agenza ownership of it.

A worktree already checked out or assigned to another terminal cannot be assigned again. Changing a
terminal assignment never cleans the previous worktree automatically.

### Remove a terminal safely

The **Remove** confirmation describes exactly what is affected. Removal terminates only that
terminal process tree and deletes only its saved terminal definition. Its project directory,
worktree directory, Git registration, local branch, commits, and Agenza worktree ownership record
remain present.

Terminal removal, Agenza-created worktree cleanup, and branch deletion are deliberately separate
operations. Agenza `0.2.0` has no branch-deletion operation.

### Clean an Agenza-created worktree

**Clean worktree** is a separate global action. It lists only unassigned worktrees that Agenza
previously created and recorded. An attached external worktree is never eligible.

Before confirmation and again immediately before removal, Agenza requires the worktree to be:

- unassigned from every terminal;
- still present and registered at the expected path;
- unlocked; and
- free of tracked, untracked, and conflicted changes.

Cleanup uses normal, non-forced `git worktree remove`. If any check fails, cleanup is refused and the
directory, registration, files, and branch are preserved. Successful cleanup removes the worktree
and its Agenza ownership record but never deletes its local branch.

### Recover stale workspace state

Moving or deleting a repository, branch, or worktree outside Agenza can make a saved assignment
stale. Use **Refresh Git** to inspect it, then either:

- use **Reassign Git** to preview and confirm a valid registered worktree; or
- use **Detach saved workspace** to stop only that terminal and clear only its saved assignment.

Detach does not delete a directory, registration, branch, or worktree ownership record. Agenza does
not run `git worktree prune`. Before showing cleanup choices it reconciles only its local ownership
catalog: a uniquely moved unassigned worktree receives its current Git path, and a stale record is
forgotten only after Git proves that the worktree is no longer registered. Ambiguous, assigned, and
temporarily inaccessible records are preserved.

## Keyboard and accessibility

- **F6** and **Shift+F6** move focus forward or backward through the current visible pane order and
  wrap at either end.
- **Ctrl+C** copies selected terminal text; without a selection it interrupts Codex.
- **Ctrl+V** pastes into the active terminal.
- Workspace dialogs keep keyboard focus inside the dialog and return it to the invoking control.
- Terminal and workspace state changes use accessible names, visible focus indicators, and live
  status announcements.

Only unmodified **F6** and **Shift+F6** are Agenza workspace shortcuts. Combinations that also use
Ctrl, Alt, or the Windows/Meta key remain available to Codex and the terminal.

## Workspace state and privacy

The versioned workspace layout is stored at `%APPDATA%\Agenza\workspace-state.json`, with the
previous valid state retained as `workspace-state.backup.json`. Invalid or newer state is preserved
without overwrite and opens a recoverable default view.

Agenza stores newline-delimited JSON diagnostics at `%APPDATA%\Agenza\logs\agenza.log`. Logs may
include application, process, and safe workspace lifecycle categories, but never terminal input,
terminal output, commands, repository paths, branch or file names, remote URLs, credentials,
environment values, or authentication secrets.

## Safety boundaries

- Git discovery, refresh, restore, and status operations are read-only.
- Every local Git mutation has a preview, validation, and explicit confirmation.
- Worktree cleanup never uses force and never deletes a branch.
- Removing or reassigning a terminal never cleans a previous worktree.
- A failure is contained to the affected pane or operation.
- Agenza does not automatically merge, rebase, cherry-pick, commit, fetch, pull, push, resolve
  conflicts, prune worktrees, or delete branches.
- Closing Agenza terminates Codex process trees but preserves every Git workspace.

## Development requirements

Repository agents must run project commands through the Conda environment named `agenza`, as
defined in [AGENTS.md](AGENTS.md). This is only a development workflow rule and is not an
application runtime dependency.

Required development tools:

- Windows with ConPTY support.
- Conda and an environment named `agenza`.
- Node.js `22` or newer and npm inside that environment.
- Codex CLI installed globally for interactive application testing.
- Git.
- Visual Studio Build Tools with the C++ workload only if node-pty cannot use its prebuilt binary.

Install dependencies and start the development app:

```powershell
conda run -n agenza npm install
conda run -n agenza npm run dev
```

For the shortest non-Conda development instructions, see [HOWTORUN.md](HOWTORUN.md).

## Tests and build commands

```powershell
conda run -n agenza npm test
conda run -n agenza npm run test:smoke
conda run -n agenza npm run test:all
conda run -n agenza npm run lint
conda run -n agenza npm run format:check
conda run -n agenza npm run build
conda run -n agenza npm run make
conda run -n agenza npm run test:release
```

- `npm test` runs the unit and integration tests, including temporary Git repositories.
- `npm run test:smoke` exercises the packaged dynamic layout, isolated Git worktrees, controls,
  persistence, cleanup reconciliation, shutdown, and orphan detection.
- `npm run test:all` runs the unit suite, creates a fresh package, and runs the smoke test.
- `npm run build` creates the unpacked app under `out/Agenza-win32-x64`.
- `npm run make` creates `Agenza-0.2.0 Setup.exe` and its Squirrel package under
  `out/make/squirrel.windows/x64`.
- `npm run test:release` checks the expected version, executable metadata, installer, Squirrel
  manifest, application archive, executable, and native ConPTY runtime.

The generated `out/` directory is ignored by Git. Release installers are attached to a GitHub
Release instead of being committed to the repository.

## Troubleshooting

### Codex CLI was not found on PATH

Open a normal terminal and run `codex --version`. Install, authenticate, or repair Codex if the
command fails. If it works there, fully close and reopen Agenza so the desktop app receives the
updated `PATH`.

### Git was not found on PATH

Open a normal terminal and run `git --version`. Install or repair Git, then fully restart Agenza.
Ordinary project folders remain usable without Git, but repository and worktree features require it.

### A Git workspace cannot be created or attached

Read the error in the affected pane or workspace dialog. Common causes are an invalid or existing
branch name, a branch already checked out elsewhere, an existing or registered target path, a
locked/prunable worktree, a bare or detached repository state, or repository changes since the
preview. Inspect the repository with `git status` and `git worktree list`, then request a fresh
preview. Agenza does not mutate the repository when validation fails.

### Worktree cleanup is refused

Cleanup is intentionally refused for assigned, dirty, untracked, conflicted, locked, missing, or
externally attached worktrees. Inspect the named worktree with `git status`, preserve or commit its
work, and retry only when it is clean and unassigned. Agenza never forces cleanup or deletes the
branch.

### A saved workspace is stale

Use **Refresh Git**. If Git reports one valid moved worktree, review **Reassign Git**; otherwise use
**Detach saved workspace** to clear only the terminal metadata. Manage branch deletion, manual
worktree repair, or pruning outside Agenza after making a backup.

### The saved workspace state cannot be loaded

Agenza preserves invalid or newer state instead of overwriting it. Close Agenza, back up
`%APPDATA%\Agenza\workspace-state.json` and its backup file, then inspect or move the invalid source
before reopening the app. Git directories and worktrees are not changed by this recovery view.

### Codex exited unexpectedly

Use **Restart** in the affected pane. Other sessions remain active. Check the sanitized diagnostic
log if the process repeatedly exits.

### The app is blank or unresponsive

Close Agenza and open it again. If the problem continues, reinstall the official build and inspect
`%APPDATA%\Agenza\logs\agenza.log`.

### A development build reports that conpty.node is locked

Close every running Agenza window and any `npm run dev` process, then build again. A running Electron
development instance keeps the native node-pty module open on Windows.

### Windows warns about the installer

Release `0.2.0` is not code-signed. Confirm that the installer came from the project's own GitHub
Release before running it.

## Known limitations in 0.2.0

- Windows only and Codex is the only supported CLI.
- Terminal sessions do not communicate, link, delegate, or orchestrate work with each other.
- Git operations are local only; Agenza does not manage remotes, hosting accounts, authentication,
  fetch, pull, push, merge, rebase, commits, or conflict resolution.
- Branch deletion and forced worktree cleanup are intentionally unavailable.
- Attached external worktrees cannot be cleaned by Agenza.
- No accounts, multi-user collaboration, cloud synchronization, or remote terminals.
- No automatic updates or code signing.

See [docs/release-notes-0.2.0.md](docs/release-notes-0.2.0.md) for the publication-ready release
notes, [CHANGELOG.md](CHANGELOG.md) for the complete change summary, and
[docs/manual-release-test.md](docs/manual-release-test.md) for the validated workspace checklist.
The completed `0.2.0` implementation plan remains in [todo.json](todo.json); the `0.1.0` plan is
archived in [todo-v0.1.0.json](todo-v0.1.0.json).
