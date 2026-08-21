# Agenza 0.3.0 orchestration scope

## Objective

Agenza `0.3.0` adds the first functional multi-agent orchestration layer on top of the completed
`0.2.0` dynamic-terminal and Git-worktree foundation. A user supplies one text goal and a bounded
set of options. Agenza asks an orchestrator agent for a structured plan, validates that plan, and
runs independent implementation agents in isolated worktrees without requiring the user to create
each terminal manually.

The input contract is intentionally source-neutral:

```js
startOrchestration({ goal, options, projectWorkspaceId });
```

The goal may later come from speech-to-text, a keyboard, or another local interface. Voice capture
and transcription are not part of this release.

## In scope

- Explicit persisted orchestration, task, and agent identities and lifecycle states.
- Dependency-aware scheduling with a user-defined `maxAgents` limit.
- A provider boundary with Codex App Server as the first implementation.
- Structured Codex threads, turns, completion, failure, and interruption events.
- One Agenza-created branch and worktree per implementation agent.
- One terminal definition associated with each implementation agent so the workspace remains
  inspectable through the existing terminal UI.
- A persistent project-workspace catalog and sidebar that own project selection and terminal
  membership independently from terminal runtime state.
- Consistent orchestrator and worker instruction generation.
- A narrow main-process IPC surface and a minimal goal/tasks/agents UI.
- Safe stop, application-shutdown cleanup, persistence, and interrupted-run recovery.
- Internal events suitable for a later graph or 2D map.

## Defaults and limits

The validated option model contains:

| Option             | 0.3.0 default       | 0.3.0 behavior                                                              |
| ------------------ | ------------------- | --------------------------------------------------------------------------- |
| `maxAgents`        | `2`                 | Maximum worker agents in one run and maximum concurrent workers. Range 1-4. |
| `maxDepth`         | `1`                 | Workers cannot create subordinate agents.                                   |
| `allowedProviders` | `["codex"]`         | Only the installed Codex provider is currently available.                   |
| `preferredModels`  | `{ "codex": null }` | `null` uses the user's current Codex default.                               |
| `autoSpawn`        | `true`              | Valid planned tasks are provisioned automatically.                          |
| `autoStop`         | `true`              | Completed runtimes are released automatically.                              |
| `autoCommit`       | `true`              | Agenza creates a fixed-message commit when a worker changed its worktree.   |
| `autoMerge`        | `false`             | No automatic merge, rebase, or cherry-pick is performed.                    |
| `requireReview`    | `true`              | Completed work is reported as ready for review/integration.                 |

The first release constrains the number of planned implementation tasks to `maxAgents`. The model
already separates the concurrency limit from task identity so later releases can schedule more
tasks through a smaller reusable agent pool.

## User workflow

1. The user adds a project folder to **Workspaces** and selects that project.
2. The user enters a goal, chooses `maxAgents`, and starts orchestration.
3. The main process resolves and validates the project from its opaque project-workspace ID.
4. A read-only orchestrator thread returns a schema-constrained plan.
5. Agenza validates task IDs, dependencies, priorities, ownership hints, and limits.
6. For each ready task, Agenza creates a terminal definition and a new branch/worktree from the
   project base revision, then starts a Codex App Server thread in that worktree.
7. Structured provider events update agent and task state. A dependent task is not started until
   every declared dependency completed.
8. If enabled, Agenza commits the completed worktree with a fixed local message.
9. The run completes with branches and worktrees preserved and marked ready for review. No merge or
   cleanup happens automatically.
10. Stopping a run interrupts live turns and processes but preserves terminals, worktrees, branches,
    commits, and results.

Starting orchestration is the explicit user action authorizing the bounded creation of the plan's
branches, worktrees, terminal definitions, and agent runtimes. It is not authorization to delete,
merge, push, pull, or rewrite Git data.

## Safety and privacy

- Renderer payloads never contain an executable, shell arguments, worktree path, or repository
  path. The main process resolves the project from a validated project-workspace ID.
- Provider and Git processes are launched with fixed internal commands and argument arrays.
- Worker sandbox roots are limited to their assigned worktree and network access is disabled by
  default. Headless turns use a non-interactive approval policy.
- The orchestrator thread is read-only and cannot create agents directly. It returns only a plan;
  Agenza validates and executes resource intentions.
- One canonical Git worktree path cannot be assigned to two terminals or agents.
- Provider process trees join the existing window resource-disposal lifecycle.
- Logs contain event names, states, counts, provider names, and one-way correlators only. They do
  not contain goals, task descriptions, prompts, results, model output, paths, branches, commands,
  diffs, terminal content, or secrets.
- Local orchestration state persists the user's goal, structured task descriptions, agent metadata,
  and final summaries to support inspection and recovery. It never persists streamed reasoning,
  command output, environment values, approvals, credentials, or terminal content.

## Deferred behavior

- Automatic review execution, merge, rebase, cherry-pick, conflict resolution, push, pull, fetch,
  branch deletion, and worktree cleanup.
- Propagating dependency commits into a downstream task worktree. Dependencies control scheduling
  in `0.3.0`; tasks that require combined code remain ready for the later integration phase.
- Reusing one worker agent for multiple tasks or planning more tasks than `maxAgents`.
- Resuming an in-flight provider turn after application restart. Interrupted runs recover as
  stopped while their Git work remains intact.
- Providers other than Codex, nested delegation, voice input, remote projects, and the 2D map.
- A terminal UI attached to the same App Server thread. The associated terminal pane is an advanced
  view of the agent's workspace; structured agent activity is shown in the orchestration panel.

## Release success

Given a valid selected Git project workspace, the user can request two independent test-coverage tasks with
`maxAgents: 2`; Agenza produces a validated plan, creates two isolated branches/worktrees and two
associated terminal definitions, starts two structured Codex agent turns, reports their independent
state and results, stops all provider processes cleanly, and finishes with both branches ready for
review without merging or deleting anything.
