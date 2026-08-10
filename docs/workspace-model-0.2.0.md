# Agenza 0.2.0 terminal and workspace model

This document turns the [0.2.0 scope and safety rules](scope-0.2.0.md) into the technical contract
used by dynamic terminal, persistence, Git discovery, and worktree implementation tasks.

## Model layers

Agenza keeps persisted identity, process runtime, and workspace runtime separate:

```text
Persisted TerminalDefinition
  ├─ stable identity, label, order
  └─ WorkspaceAssignment (unassigned, folder, or Git worktree)

Runtime TerminalRuntime
  └─ process state, PTY handle, PID, exit information

Runtime WorkspaceRuntime
  └─ validation state, discovered Git status, active operation and recovery information
```

Only terminal definitions, their committed assignments, and the separate managed-worktree catalog
are written to disk. The catalog records the Agenza creation ID, repository root, branch ref, and
worktree path independently from any terminal. Runtime objects and cleanup previews are recreated
after every app start.

## Stable terminal identity

Each terminal receives an ID in the form `terminal-<UUIDv4>`, generated once with a cryptographically
secure UUID generator. The ID is persisted and remains stable through app restarts, label changes,
reordering, process restart, workspace reassignment, and stale-state recovery.

The ID is the only terminal identity used by IPC and process routing. Labels are editable display
values, do not need to be unique, and must never be used as map keys. Removing a terminal retires its
ID permanently; restored or newly added terminals receive new IDs.

Implementations must validate both the ID format and membership in the current terminal registry.
User-supplied IDs, reuse of removed IDs, and routing by array index are not allowed.

## Persisted terminal definition

The canonical schema is [workspace-state-schema-v1.json](workspace-state-schema-v1.json). Its
top-level object contains:

- `schemaVersion`: the integer `1`.
- `revision`: a monotonically increasing local write revision.
- `activeTerminalId`: a current terminal ID or `null` when no pane is active.
- `managedWorktrees`: Agenza-created worktrees retained independently from terminal assignments.
- `terminals`: the ordered terminal definitions.

Each terminal definition contains:

- `id`: stable `terminal-<UUIDv4>` identity.
- `label`: user-facing name, between 1 and 80 characters.
- `order`: zero-based display order.
- `createdAt` and `updatedAt`: UTC ISO 8601 timestamps.
- `workspace`: one discriminated workspace assignment.

Cross-record validation, which JSON Schema cannot fully express, additionally requires:

- terminal IDs are unique;
- `order` values are unique and contiguous from zero;
- `activeTerminalId` is `null` or references a stored terminal;
- one canonical Git worktree path is not assigned to multiple terminals; and
- `projectPath` equals `repository.worktree.path` for a Git worktree assignment.

## Workspace assignments

### Unassigned

An unassigned terminal has `kind: "unassigned"`, a `null` project path, and no repository. It has no
running Codex process and can be safely displayed, reordered, persisted, or removed.

### Ordinary folder

A folder assignment has `kind: "folder"`, an absolute `projectPath`, and no managed repository
metadata. The selected folder may happen to be inside a Git repository, but Agenza treats it as a
plain folder until the user explicitly chooses a Git workspace flow.

### Git worktree

A Git assignment has `kind: "git-worktree"` and stores:

- `projectPath`: the terminal working directory;
- `repository.root`: the canonical absolute repository root discovered by Git;
- `repository.branch`: the last validated full local branch name;
- `repository.worktree.path`: the canonical absolute worktree path; and
- `repository.worktree.ownership`: explicit `external` or `agenza` ownership metadata.

For this assignment, `projectPath` and `repository.worktree.path` must be equal after Windows path
normalization. Persisted repository data is last-known metadata and never replaces fresh read-only
Git discovery during restore or before a mutation.

## Worktree and branch ownership

An attached pre-existing worktree uses:

```json
{
  "kind": "external",
  "creationId": null
}
```

A worktree created successfully by Agenza uses `kind: "agenza"` and a stable
`worktree-<UUIDv4>` creation ID. Ownership is committed only after `git worktree add` succeeds and
the result is rediscovered at the expected canonical path.

Ownership grants permission only to offer the guarded worktree-cleanup workflow. It does not grant
ownership of the repository, branch, commits, or user files. Attaching an existing worktree never
changes its ownership to `agenza`. Branches have no ownership flag because Agenza never deletes
branches in `0.2.0`.

Each successfully created worktree is also recorded in the top-level managed-worktree catalog by
creation ID, repository root, full local branch ref, and canonical path. Removing a terminal or
changing its assignment leaves this record intact. Cleanup is therefore available only after the
worktree is no longer assigned, even across application restarts. Successful verified cleanup
removes the catalog record; it never removes the branch.

## Terminal process lifecycle

Process state exists only in the Electron main process and is never persisted.

| State        | Meaning                                              | Allowed next states                         |
| ------------ | ---------------------------------------------------- | ------------------------------------------- |
| `waiting`    | No PTY is running                                    | `starting`, `stopping`                      |
| `starting`   | Prerequisites are checked and a PTY is being created | `connected`, `error`, `exited`              |
| `connected`  | Codex PTY is running                                 | `restarting`, `stopping`, `exited`, `error` |
| `restarting` | The old tree is stopping before replacement          | `starting`, `waiting`, `error`              |
| `stopping`   | The complete process tree is being terminated        | `waiting`, terminal removal                 |
| `exited`     | The PTY ended unexpectedly                           | `restarting`, `stopping`                    |
| `error`      | Start, runtime, or cleanup failed                    | `starting`, `restarting`, `stopping`        |

A workspace operation cannot silently move a terminal through these states. It first commits a
successful assignment, then asks the terminal lifecycle to restart that one session. If assignment
fails, the existing process and persisted assignment stay unchanged.

## Git workspace lifecycle

Workspace state is also runtime-only and independent from the PTY state.

| State        | Meaning                                                               | Allowed next states                 |
| ------------ | --------------------------------------------------------------------- | ----------------------------------- |
| `unassigned` | No folder or Git workspace is committed                               | `validating`                        |
| `validating` | Paths and read-only Git facts are being checked                       | `ready`, `stale`, `error`           |
| `ready`      | Persisted assignment matches current filesystem/Git facts             | `validating`, `mutating`, `stale`   |
| `mutating`   | One confirmed local create, attach, or cleanup transaction is running | `ready`, `stale`, `error`           |
| `stale`      | Persisted metadata no longer matches disk or Git                      | `validating`, `unassigned`, `error` |
| `blocked`    | A requested cleanup is refused by a safety condition                  | `validating`, `ready`               |
| `error`      | Discovery or mutation failed without a safe committed result          | `validating`, `unassigned`          |

`blocked` reports that existing work must be preserved; it is not a failed terminal state. A
connected terminal may remain connected while its read-only Git status is stale or blocked, unless
its actual working directory becomes inaccessible.

### Stale assignment recovery

Restore and manual status refresh compare each saved Git assignment with the current repository,
branch, registered worktree path, and worktree branch. A moved worktree is reported with its newly
registered candidate path. Missing repositories, branches, worktrees, prunable registrations, and
worktrees that changed branch are reported as terminal-local stale states; inspection never runs
`git worktree prune` or changes repository metadata.

When the saved repository root remains readable, the user can review and reassign a valid registered
worktree through the normal preview and confirmation flow. Reassigning an Agenza-created worktree
that Git proves was moved retains its creation ID and updates the managed-worktree catalog path.
Alternatively, the user can detach the saved assignment. Detach stops only that terminal process,
atomically persists an unassigned terminal, and keeps the branch, directory, Git registration, and
managed ownership record unchanged. If persistence fails, the process remains stopped and the last
valid assignment remains on disk for recovery after restart.

## Confirmed Git operation lifecycle

Every mutating Git workflow uses an ephemeral operation object with a new operation ID and these
states:

```text
draft -> previewed -> confirmed -> running -> succeeded
                                      └────> failed -> rolled-back | manual-recovery
```

The preview contains operation type, repository root, base branch when relevant, target branch, and
target worktree path. It expires when any input changes or rediscovery returns different facts. Only
the main process executes the confirmed operation.

Persisted terminal state changes only after the operation succeeds and the result is rediscovered.
A rollback may remove only a worktree or branch that the same failed operation demonstrably created;
it must never force removal or modify pre-existing Git data. If safe rollback cannot be proven, the
operation enters `manual-recovery` and preserves all remaining resources.

## Persistence and migration

State is stored locally at `%APPDATA%\Agenza\workspace-state.json`. Writes use a temporary file in
the same directory, validation, and atomic replacement so a crash cannot leave partially written
JSON. The previous valid file is retained as a recovery backup before replacement.

Release `0.1.0` stored no workspace layout, so absence of the file migrates to schema v1 by creating
two unassigned terminal definitions with new IDs, labels `Terminal 1` and `Terminal 2`, and the first
terminal active. This preserves a familiar first-run layout while allowing the user to remove every
pane or add more.

Early development schema-v1 files may omit `managedWorktrees`. They load as an empty catalog, while
any still-assigned Agenza-owned worktrees are imported from their existing ownership metadata. The
normalized catalog is persisted with the next ordinary state mutation, without changing Git.

For invalid JSON, invalid cross-record invariants, or an unknown higher `schemaVersion`, Agenza must
not overwrite the source file. It starts a recoverable empty/default view, reports the problem, and
preserves the unread state for manual recovery. Future migrations must be explicit, sequential, and
tested from every supported prior schema version.

## Data that is never persisted

The workspace state must not contain:

- terminal input, output, scrollback, selections, cursor state, or clipboard content;
- PTY handles, process IDs, exit codes, process environment, or executable search paths;
- Codex prompts, responses, authentication state, tokens, or other secrets;
- Git credentials, credential-helper output, command transcripts, remote URLs containing
  credentials, diffs, file contents, or commit messages; or
- transient validation errors, dirty-file lists, operation previews, or runtime lifecycle states.

Logs follow the same privacy boundary. They may record stable terminal IDs, safe operation IDs,
state names, ownership kind, timestamps, and sanitized error categories, but not terminal content or
secret-bearing Git arguments.

## Implementation boundaries

- The Electron main process owns terminal definitions, runtime state, persistence, path
  canonicalization, Git discovery/mutations, and process cleanup.
- Managed-worktree cleanup uses a short-lived main-process preview, repeats ownership, assignment,
  registration, filesystem, lock, and clean-status checks inside the repository mutation queue,
  and invokes only normal `git worktree remove` without `--force`.
- The preload bridge exposes narrow commands and immutable snapshots; it never exposes filesystem,
  shell, unrestricted Git, or persistence APIs.
- The renderer displays snapshots and submits user intent. It cannot declare a worktree owned,
  change process state, or write persisted state directly.
- One serialized mutation queue per repository prevents overlapping worktree operations while
  unrelated repositories and terminal PTYs remain independent.
