# Agenza technical architecture

This document records the shipped `0.1.0` architecture that `0.2.0` builds on. The new release scope
and non-destructive Git boundaries are defined in [scope-0.2.0.md](scope-0.2.0.md). The dynamic
terminal, workspace lifecycle, ownership, and persisted schema contract are defined in
[workspace-model-0.2.0.md](workspace-model-0.2.0.md).

## Decision

Agenza will be a Windows desktop application built with Electron and plain JavaScript. The first release will not use TypeScript, React, or another UI framework.

The selected stack is:

- Electron for the desktop application shell.
- Plain JavaScript, HTML, and CSS for the application and interface.
- `@xterm/xterm` for terminal rendering and input.
- `@xterm/addon-fit` for fitting each terminal to its pane.
- `node-pty` for independent interactive Windows ConPTY processes.
- Electron Forge with its Webpack template for development and packaging.
- The Electron Forge Squirrel maker for the first Windows installer.
- npm for JavaScript package management.

Package versions will be pinned when the application is scaffolded in task `T003`.

## Architecture

The Electron renderer builds xterm.js panes from a reusable HTML template. It lists the main-process
registry during startup and can add or remove panes without fixed DOM or process IDs. The renderer
does not receive direct access to Node.js, Electron, or operating-system APIs.

A preload script will expose a small, explicit API for terminal input, output, resize, restart, and cleanup. Electron context isolation and renderer sandboxing will remain enabled, and Node.js integration will remain disabled in the renderer.

The Electron main process owns a dynamic registry of `node-pty` sessions. Each session runs Codex
independently in its selected project folder. Output is sent only with the stable ID of its source
terminal, and removing, closing, or restarting a session terminates its complete child process tree.

```text
Renderer: xterm pane A  <-- stable terminal ID -->  Main: dynamic PTY registry  --> Codex
Renderer: xterm pane B  <-- stable terminal ID -->  Main: dynamic PTY registry  --> Codex
```

The terminal process layer uses one `TerminalSession` per PTY. `TerminalManager` starts empty and can
create, list, start, restart, remove, and dispose any number of sessions. New sessions receive
cryptographically generated `terminal-<UUIDv4>` IDs, which are used for registry membership, IPC,
and event routing. Removed IDs are retired for the lifetime of the manager. Restart and removal act
on one registered session; removal disposes its complete process tree before deleting its registry
entry. Aggregate data and exit subscriptions include their source ID, so sessions created after IPC
registration remain isolated and observable.

`WorkspaceService` owns the persisted terminal definitions separately from `TerminalManager`'s
runtime PTYs. On a first launch it creates two unassigned definitions; later launches restore the
saved IDs, labels, order, active terminal, and workspace assignments. The renderer supports an empty
workspace, a full-width single pane, two columns, and a scrollable responsive grid for more panes.
Runtime snapshots combine the saved definition with current process and path-availability state,
without writing process IDs, terminal content, or transient errors to disk.

Terminal removal is a terminal-only transaction. The renderer confirmation names the saved pane
and, when assigned, the branch and worktree that will remain. `WorkspaceService` removes only that
terminal definition, updates the remaining layout order, and asks `TerminalManager` to dispose only
the matching process tree. It invokes no Git command and never removes a project directory,
worktree registration, or branch. If process-tree disposal fails, the previous terminal definition
and its workspace assignment are written back so the pane can be recovered and removal retried.

A separate persisted managed-worktree catalog retains the creation ID, repository root, branch ref,
and canonical path for every worktree created by Agenza. Its record survives terminal removal and
workspace reassignment, so ownership is not inferred from arbitrary Git directories. The global
cleanup dialog lists only these recorded resources and disables assigned ones. Its first step
creates a short-lived preview after checking that the directory exists, remains registered and
unlocked, and has no tracked, untracked, or conflicted changes. Confirmation repeats every check
inside the same per-repository mutation queue used by creation, then runs normal
`git worktree remove` without force. Agenza verifies that the directory and registration are gone,
verifies that the local branch still exists, and only then removes the ownership record.

`WorkspaceStateStore` validates schema v1 and cross-record invariants before every read and write.
It writes `workspace-state.json` through a validated temporary file and atomic rename, retaining the
previous valid state as `workspace-state.backup.json`. Every saved mutation increments `revision`.
Invalid JSON, unknown schema versions, or invalid invariants are preserved without overwrite and
open a recoverable default view. State mutations are serialized so rapid renderer actions cannot
race writes.

Before starting a pane, Agenza verifies that `codex --version` works in the user's normal system
environment and then starts its Codex PTY from that same environment. The application does not
activate or require Conda at runtime. A missing Codex installation or `PATH` entry produces a concise
startup error in the affected pane.

The preload bridge exposes narrow terminal create, list, remove, start, restart, input, resize,
output, and exit operations. The main process validates the sending frame, live registry membership,
input type, and dimensions before routing a request. Aggregate renderer subscriptions are registered
before PTYs start and also cover sessions created later, so initial output is not lost.

Each pane has an independent folder button backed by a narrow project-selection bridge and
Electron's native directory picker. The main process stores one folder per terminal ID and accepts
only IDs that still belong to the dynamic terminal registry and absolute directories that can be
read and written. A valid first selection starts only that Codex session with the folder as `cwd`; a
later selection stops and restarts only that session. Each pane header displays its own full project
path. Accessible restored folders are shown as ready without automatically starting Codex. Missing
or inaccessible restored paths are shown locally as unavailable and can be replaced without
preventing other definitions from loading. Cancellation and validation errors leave the other
terminals untouched.

Saved Git worktrees receive a deeper read-only restore and refresh check. Agenza compares the saved
repository, branch, worktree registration, path, and checked-out branch with current Git discovery.
Externally moved, removed, renamed, prunable, or inaccessible resources become a terminal-local
stale status. A readable repository root can still drive the existing previewed reassignment flow;
otherwise the pane offers a confirmed metadata-only detach. Detach stops only that terminal before
atomically clearing its assignment and never deletes a directory, branch, registration, or managed
ownership record. Recovery inspection does not run `git worktree prune` or any other Git mutation.

Read-only Git discovery also runs only in the main process. The preload bridge accepts a stable
terminal ID, never an arbitrary path or command, and discovers the repository from that terminal's
validated current folder. Git is launched directly without a shell, with a five-second timeout, a
one-megabyte output limit, hidden Windows process windows, and fixed internal arguments. An
independent main-process watchdog terminates and rejects a stalled child even if the normal process
callback never arrives. Discovery
uses `rev-parse`, `worktree list --porcelain -z`, and `for-each-ref` to return the canonical main
repository root, selected worktree path, current branch or detached state, local branches, and all
registered worktrees including locked or prunable metadata. These commands do not mutate repository
state. Missing Git, non-repository folders, timeouts, excessive output, and unexpected formats are
converted to concise structured errors carrying the requesting terminal ID, so one failure cannot
affect another terminal or PTY. Every structured error also carries a fixed recovery action that the
renderer shows only in the affected terminal summary or workspace dialog.

Each terminal pane has a runtime-only Git summary showing the discovered repository root, current
branch, worktree path, and aggregate change counts. Refresh invokes the fixed read-only command
`git status --porcelain=v2 -z --untracked-files=normal --ignore-submodules=none` from the validated
worktree. The bounded parser returns only tracked, untracked, and conflicted counts plus a clean
flag; file names, file contents, diffs, and status output are not exposed to the renderer, persisted,
or logged. A response is applied only if the terminal still owns the same project path. Missing Git,
non-repository folders, malformed or excessive output, and timeouts update only that pane's Git
summary and never change its Codex process state or another terminal's status.

`GitWorkspacePlanner` turns fresh discovery facts and renderer intent into an immutable,
runtime-only operation preview. It supports three explicit intents: create a new branch and
worktree, create a worktree for an eligible existing branch, or attach an existing registered
worktree. Git validates branch names with `check-ref-format --branch`; discovery and filesystem
checks reject missing or conflicting branches, branches already checked out elsewhere, registered
or terminal-assigned paths, existing target directories, nested worktrees, inaccessible parents,
and locked, detached, prunable, bare, or unborn repository states as applicable. Planning never
creates a branch, directory, or worktree. A successful preview contains its operation ID, terminal
ID, repository root, base branch and revision, target branch and revision, final worktree path, and
a fingerprint of the discovery facts. The T208/T209 confirmation flows must rediscover and match
those facts before any mutation. Previews remain only in a bounded main-process registry for up to
five minutes; a new preview for the same terminal invalidates the old one, and previews are never
persisted.

The new-branch confirmation path revalidates its preview inside a per-repository mutation queue,
then invokes Git directly with `worktree add --no-track -b` from the previewed base revision. After
Git returns, Agenza rediscovers the target path and verifies the repository root, worktree path,
branch ref, exact starting revision, and lifecycle flags before recording the worktree as
Agenza-created. `WorkspaceService` atomically assigns that versioned ownership record only to the
selected terminal, and the main process starts or restarts only that terminal's Codex PTY with the
new worktree as its working directory. The renderer requires a second, exact preview of repository,
base revision, target branch, and path before it enables creation.

The same confirmation dialog can create a worktree for an eligible existing local branch or attach
an already registered worktree. Existing-branch creation uses a normal `git worktree add` without
creating or deleting the branch; verification is identical to new-branch creation, and a failed
transaction may roll back only the worktree it added. Attachment executes no mutating Git command,
records `external` ownership, and atomically changes only the selected terminal assignment. Branches
already checked out elsewhere are omitted from the eligible creation list, while the main-process
planner remains authoritative for checked-out, locked, prunable, detached, or terminal-assigned
conflicts.

Every confirmation fetches the current terminal-to-worktree assignments again inside the
per-repository queue. If another terminal acquired the previewed path, or Git changed after the
preview, confirmation is refused without mutation and the user must review fresh facts. Successful
new, existing-branch, and attachment assignments all start or restart only their owning terminal.

If creation, verification, or persistence fails, rollback considers only the branch and worktree
named by that operation. It rediscovers Git state before each cleanup step, requires the exact
previewed branch ref and revision, refuses locked or ambiguous resources, removes the worktree and
branch without force, and reports manual recovery instead of risking pre-existing Git data. A Codex
startup failure after successful persistence does not roll back completed Git work: the new
workspace remains assigned and the affected pane offers Restart.

Session controls are scoped by stable terminal IDs. For a running session, Clear sends the
standard Ctrl+L terminal control to the selected PTY so Codex clears the screen and redraws its input
at the correct cursor position. A stopped or not-yet-started pane is reset locally. Restarting asks
the main process to replace only the selected PTY. An unexpected exit disables input in that pane,
displays the exit status, and leaves its restart control enabled; the other pane continues running.

The renderer handles only unmodified F6 and Shift+F6 to cycle terminal focus in current DOM display
order, including after dynamic additions, removals, restored ordering, or a future visual reorder.
The sequence wraps in both directions and can move focus from application chrome to a single
remaining terminal. The xterm custom-key boundary consumes these two application shortcuts before
they reach Codex; combinations using Ctrl, Alt, or Meta continue to the active xterm instance.
Workspace dialogs suspend pane cycling and restore focus to their invoking control or assigned
terminal when closed.

Each xterm runs in screen-reader mode. Terminal and Git state changes use terminal-specific polite
live regions, while add, remove, assignment, cleanup, and recovery outcomes use a workspace live
region. Native controls expose action- and terminal-specific accessible names, dialog relationships,
expanded and busy states, and high-contrast `:focus-visible` outlines. The pane containing keyboard
focus receives the same strong visual outline as the active pane.

On Windows, stopping a session uses the system `taskkill` executable with tree and force flags for
the PTY's root PID. This synchronously terminates Codex and any descendant shell processes before a
restart can create the replacement session. The same cleanup runs for every registered session on
the window's `close` event, before Electron exits. The regular node-pty kill remains a fallback when the
root process has already exited, and resource disposal attempts every session even if another
cleanup reports an error.

The packaged startup check creates a long-running descendant process in each PTY immediately before
closing its window. After the synchronous close cleanup, it checks both descendant PIDs and fails if
either still exists. This exercises the same window-close path used by the normal application.

The main process writes newline-delimited JSON diagnostics to `agenza.log` in Electron's local logs
directory. Logging is limited to application, window, IPC, and terminal lifecycle metadata. The
input and output routes never call the logger, sensitive field names are always redacted, token-like
values and control characters are sanitized, and logging failures do not stop the app. Terminal
startup and restart errors are caught per ID, logged without terminal content, and returned only to
the affected pane with a concise recovery instruction. Git lifecycle logging has a stricter
allowlist: it accepts only fixed Git event names, error categories, operation/state/ownership values,
and one-way hashed terminal, preview, or Agenza-worktree correlators. Repository and worktree paths,
branch and file names, commands and arguments, stdout/stderr, remote URLs, environment values, and
raw errors are discarded before reaching the general logger.

Automated validation has four entry points. `npm test` runs the Node test suite with faked PTY and
Electron boundaries. `npm run test:smoke` launches the packaged executable with `--startup-check`
and a 60-second timeout. `npm run test:all` runs the unit suite, packages the application, and then
runs the smoke test sequentially. The smoke check exercises three-, two-, one-, and zero-pane
layouts before recreating two real ConPTY sessions. It verifies dynamic addition and removal,
versioned state persistence and reload, stable labels, isolated markers, restart behavior, renderer
controls, keyboard focus, isolated temporary Git worktree assignment and removal, and that persistent
descendant processes do not survive window closure.
After `npm run make`, `npm run test:release` validates the Squirrel installer and package metadata
plus the packaged application archive, executable, and native ConPTY runtime.

`node-pty` remains external to the main Webpack bundle because it resolves native modules, worker
scripts, and helper scripts relative to its package directory. A build plugin copies its runtime
JavaScript and the current platform's prebuilt binaries into the Webpack output. Electron Forge
unpacks that complete runtime directory from the application archive so workers and native modules
can load from real filesystem paths.

## Why this stack

Electron lets the project use familiar web technologies while providing the native process and window APIs needed by a desktop application. xterm.js and node-pty are designed to work together: xterm.js handles terminal presentation, while node-pty provides the interactive pseudoterminal process.

Plain JavaScript keeps the first release approachable and avoids introducing a UI framework before the interface requires one. The main tradeoffs are Electron's larger application size and memory use, plus the native build and packaging requirements of `node-pty`. These are acceptable for the Windows-only personal release.

## User prerequisites

Running Agenza requires:

- Windows 10 version 1809 or newer, or Windows 11, for ConPTY support.
- An installed and authenticated Codex CLI whose `codex` command is available on the normal system `PATH`.

Conda is not an Agenza runtime requirement.

## Development prerequisites

Development requires:

- Windows 10 version 1809 or newer, or Windows 11, for ConPTY support.
- The Conda environment named `agenza`.
- Node.js and npm available inside that environment.
- The Codex CLI installed and authenticated on the system for interactive app testing.
- Git.
- Visual Studio Build Tools with the C++ workload if `node-pty` cannot use a compatible prebuilt binary.

The environment currently provides:

- Node.js `24.18.0`.
- npm `11.16.0`.
- Codex CLI `0.147.0`.

All agent project commands must follow the repository's `AGENTS.md` instructions and run through the `agenza` Conda environment. This development rule does not affect the environment used by the packaged application.

## Deferred decisions

The following choices are intentionally deferred until they are needed:

- A JavaScript UI framework.
- Support for operating systems other than Windows.
- Support for CLIs other than Codex.
- Communication between terminal sessions.
- Automatic application updates and code signing.
