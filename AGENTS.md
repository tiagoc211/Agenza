# Agent Instructions

All agents working in this repository must run project commands inside the Conda environment named `agenza`.

This is a development workflow rule for repository agents only. Conda must never be introduced as a runtime requirement for Agenza or its users; the application launches Codex from the user's normal system environment.

Use this command format:

```powershell
conda run -n agenza <command>
```

If `conda` is not available on the shell's `PATH`, use:

```powershell
& "C:\Users\Tiago\anaconda3\Scripts\conda.exe" run -n agenza <command>
```

Do not run multiple `conda run` commands concurrently. On Windows, concurrent invocations can collide while using Conda's temporary activation files.

## Project workflow

- Before changing code, read `README.md`, `todo.json`, and `docs/architecture.md`, as well as the closest applicable `AGENTS.md` file.
- Confirm that the assigned task's dependencies in `todo.json` are complete before starting implementation.
- Keep `todo.json` updated when a task is started or completed.
- Run the relevant tests, linting, and validation before marking a task as complete.
- Keep the README and files under `docs/` accurate when commands, behavior, architecture, prerequisites, or user workflows change.
- Record JavaScript runtime dependencies in `package.json` and commit the matching lockfile. Use `requirements.txt` only for Python dependencies.
- Pin direct dependency versions when practical and do not add a dependency without a clear need.
- Preserve existing user changes and avoid unrelated edits.
- Do not create commits, rewrite Git history, or perform other Git history changes unless the user explicitly requests them.

## Default prompt for a new task

When the user tells a new agent to follow the default new-task prompt, the agent must:

1. Read `AGENTS.md`, `README.md`, `todo.json`, and `docs/architecture.md` completely.
2. Inspect the current branch and working tree without discarding or overwriting existing changes.
3. Sort the tasks in `todo.json` by `order` and select the first task whose status is not `done`.
4. Confirm that all dependencies for the selected task are `done`. Do not silently skip a blocked task or a task with incomplete dependencies; report the problem to the user.
5. If the selected task is `todo`, change it to `in_progress` before implementation. If it is already `in_progress`, review the existing work and continue it only when no other agent is actively working in the same worktree.
6. Tell the user which task was selected, then complete only that task and its acceptance criteria. Make reasonable in-scope decisions without asking unnecessary questions.
7. Update relevant documentation and run the appropriate tests, linting, formatting, build, or other validation required by the task.
8. Mark the task `done` only after every acceptance criterion passes. If the task cannot be completed, leave an accurate status and clearly report the blocker.
9. Finish with a concise summary of files changed, checks performed, and the next unfinished task. Do not commit unless the user explicitly asks for a commit.

## Multi-agent coordination

- Agents working concurrently must use separate Git worktrees and separate branches. Do not run concurrent agents in the same working tree.
- Give each agent a bounded task and an explicit file ownership list that does not overlap with another active agent.
- Avoid concurrent edits to shared coordination files such as `todo.json`, `README.md`, and `AGENTS.md`. The integrating agent updates those files after merging the isolated work.
- An agent must not switch branches, cherry-pick, merge, rebase, or alter another agent's worktree unless explicitly assigned to integrate work.
- When explicitly asked to commit, include only the files owned by the assigned task. Use a focused commit message and report the branch name and commit hash.

## Release scope

- Release `0.2.0` targets Windows and builds on the completed `0.1.0` baseline.
- Keep release `0.2.0` focused on dynamic Codex terminals and safe branch/worktree isolation for each terminal.
- Treat terminal removal, worktree cleanup, and branch deletion as separate operations. Never delete a branch or worktree merely because its terminal was removed.
- Features such as automatic merge, rebase, push, pull, linked agents, additional CLI tools, accounts, and cloud synchronization are out of scope unless the user changes the release scope.

## Terminal safety and privacy

- Ensure terminal child processes and their process trees are terminated when a session restarts or Agenza closes.
- Never store secrets or terminal input in application logs.

## Electron boundaries

- Keep PTY creation, Codex process management, and filesystem access in the Electron main process.
- Keep `contextIsolation` and renderer sandboxing enabled, and keep Node.js integration disabled in the renderer.
- Expose only narrow, task-specific APIs through the preload bridge. Validate all IPC senders and arguments in the main process.
- Do not load remote content or expose unrestricted Electron, Node.js, shell, or IPC APIs to the renderer.
