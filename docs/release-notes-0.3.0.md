# Agenza 0.3.0 release notes

Agenza `0.3.0` introduces the first functional multi-agent orchestration layer. One high-level goal
can now produce a validated plan and up to four isolated Codex workers without manually creating
each terminal and worktree.

## Highlights

- Structured Orchestrator planning through Codex App Server rather than PTY text injection.
- Explicit persisted orchestrations, agents, tasks, dependencies, results, and lifecycle states.
- Automatic safe creation of one local branch, managed worktree, and associated terminal per worker.
- Dependency-aware scheduling and a validated `maxAgents` limit from 1 to 4.
- Fixed-message local commits when `autoCommit` is enabled, with completed branches left ready for
  review.
- Real-time domain events and a minimal UI for goal input, tasks, agents, status, stop, and opening
  an agent workspace.
- A persistent left Workspaces sidebar: select a project first, then create terminals and
  orchestrations that inherit that project automatically.
- Serialized worktree preview and creation per repository so parallel agent startup cannot
  invalidate another agent's Git confirmation.
- Complete provider process-tree shutdown and stopped-state recovery after application restart.

## Safety

The renderer never supplies arbitrary paths or commands. Starting orchestration authorizes only the
bounded branches, worktrees, terminal definitions, App Server turns, and optional task commits in
the validated plan. It does not authorize merge, rebase, cherry-pick, push, pull, branch deletion,
or worktree cleanup.

Stopping or closing Agenza preserves every terminal definition, worktree, branch, commit, and
completed result. Logs exclude goals, tasks, prompts, responses, paths, branches, terminal content,
commands, environment values, and secrets.

## Current limitations

Codex is the only provider. Tasks are limited to the worker count, nested delegation is disabled,
dependency commits are not propagated to downstream worktrees, and integration is review-ready
state rather than an automatic merge. Voice input and the 2D orchestration map remain future work.

See the [0.3.0 scope](scope-0.3.0.md) and
[orchestration model](orchestration-model-0.3.0.md) for the complete contracts and deferred behavior.
