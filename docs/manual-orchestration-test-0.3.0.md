# Agenza 0.3.0 manual orchestration test

Run this checklist with the packaged Windows application, an authenticated Codex CLI, and a
disposable local Git repository containing a committed testable project. Back up any work that must
not be changed.

## Automated gate

- [ ] `conda run -n agenza npm test` passes.
- [ ] `conda run -n agenza npm run lint` passes.
- [ ] `conda run -n agenza npm run format:check` passes.
- [ ] `conda run -n agenza npm run build` passes.

## Independent two-agent run

1. Confirm the goal and Start controls are hidden until a project is selected.
2. Choose **Choose project folder** in the Orchestrator panel and select the fixture repository.
3. Confirm Agenza validates the Git project and then reveals the goal controls.
4. Enter: `Analyse this project and create two independent tasks to improve test coverage.`
5. Select `maxAgents: 2` and choose **Start**.
6. Confirm the UI shows `planning`, two structured tasks, an Orchestrator agent, and two worker
   agents without manually adding terminals.
7. Confirm each worker receives a different `agenza/...` branch, worktree path, worktree ownership
   ID, terminal ID, App Server thread ID, and turn ID.
8. Confirm `git worktree list` shows both worktrees and that neither worker modifies the source
   worktree or the other worker's worktree.
9. Confirm each completed task reports a bounded summary, test outcome, and local commit.
10. Confirm the orchestration becomes `completed` with `ready-for-review`, while the source branch
    remains unchanged and no merge, push, cleanup, or branch deletion occurs.
11. Choose **Open workspace** for each agent and confirm the correct terminal pane, branch, and
    worktree are focused.

## Dependencies and limits

- [ ] Run a goal that produces one task depending on another. Confirm the dependent worker does not
      start before the prerequisite task completes.
- [ ] Repeat with `maxAgents: 1`; confirm no more than one worker is active.
- [ ] Confirm values above 4, unsupported providers, nested delegation, and `autoMerge: true` are
      refused by the main process.

## Stop, restart, and cleanup

- [ ] Stop a working run. Confirm live turns are interrupted and all non-final agents/tasks become
      stopped, while terminals, branches, worktrees, files, and commits remain.
- [ ] Close Agenza during a working run. Confirm the App Server and worker process trees do not
      survive application shutdown.
- [ ] Reopen Agenza. Confirm the interrupted run is recovered as stopped and the associated terminal
      definitions and Git work remain inspectable.
- [ ] Confirm worktree cleanup remains a separate guarded action and branch deletion is unavailable.

## Privacy inspection

- [ ] Inspect `agenza.log`. Confirm it contains only orchestration event types, state, and counts;
      goals, task text, prompts, responses, paths, branches, commands, output, and secrets are absent.
- [ ] Inspect `orchestration-state.json`. Confirm it contains structured goal/task/agent/result
      metadata but no streamed reasoning, command output, terminal content, approvals, environment
      values, credentials, or process IDs.
