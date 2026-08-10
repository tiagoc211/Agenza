# Agenza 0.2.0 manual workspace release test

Run this checklist against the packaged Windows application. Use a disposable local Git repository
with one committed file and two distinct new worktree directories. Do not use a repository that
contains work which is not safely backed up.

Record the release build, Windows version, Codex CLI version, tester, date, and any failure. For a
failure, also record the affected terminal and action, plus relevant sanitized lines from
`%APPDATA%\Agenza\logs\agenza.log`. Never copy terminal prompts, terminal output, credentials, or
repository paths into the log record.

## Automated release gate

Run these commands before the interactive test. Repository agents run them through the `agenza`
Conda environment; this is not an Agenza runtime requirement.

- [ ] `conda run -n agenza npm test` passes.
- [ ] `conda run -n agenza npm run test:all` passes, including the packaged smoke test.
- [ ] `conda run -n agenza npm run make` and `conda run -n agenza npm run test:release` pass for
      the candidate installer.

## Layout persistence and restore

Use an isolated or backed-up `%APPDATA%\Agenza\workspace-state.json` so this test does not replace a
real saved layout. Close every Agenza window before changing that file.

- [ ] Start the packaged app with the default two panes. Remove both panes; confirm the empty
      workspace gives a usable **Add terminal** action. Close and reopen Agenza; the zero-pane
      layout is restored.
- [ ] Add one terminal, assign an ordinary disposable folder, and restart Agenza. Confirm its
      label, folder, and usable one-column layout are restored.
- [ ] Add a second terminal and restart Agenza. Confirm both panes remain independently usable.
- [ ] Add at least two more terminals, set distinct labels, and restart Agenza. Confirm every pane
      remains reachable, its label and order are restored, and resize and `F6` / `Shift+F6` focus
      cycling work across the visible order.

## Two isolated Codex workspaces

1. In the first terminal, choose **Git workspace** and create a new branch and worktree from the
   fixture repository's base branch. Note the previewed branch and path, then confirm it.
2. Repeat in the second terminal with a different new branch and different worktree path.
3. Confirm the repository, branch, and worktree shown on each pane match its preview and that the
   paths and branch names are different.
4. When both sessions show **Connected**, submit independent harmless tasks at the same time. For
   example, ask terminal 1 to create `manual-agent-one.txt` containing `ONE`, and terminal 2 to
   create `manual-agent-two.txt` containing `TWO`.
5. Verify each file exists only in its intended worktree, `git worktree list` still registers both
   worktrees, and the two terminals show only their own workflow's output and status.

- [ ] Two Codex sessions completed independent work on different branches and worktrees of the
      same repository.

## Removal, guarded cleanup, and shutdown

- [ ] Remove the first terminal and accept the terminal-only confirmation. Confirm its pane is
      gone, then use `git worktree list` to verify that its worktree and branch still exist. Do not
      clean it up at this point.
- [ ] Put an untracked file in that now-unassigned Agenza-created worktree. In Agenza, request
      **Clean worktree** for it and confirm the preview. Verify cleanup is refused because the
      worktree is dirty, and that its directory, registration, and branch remain present.
- [ ] If cleanup reports a recorded worktree as missing, use **Verify and forget stale local
      record**. Confirm it proceeds only after finding no Git registration, removes only the Agenza
      catalog entry, and leaves Git files, worktrees, and branches unchanged.
- [ ] With the remaining Codex sessions running, note the session process IDs in Task Manager.
      Close Agenza normally. Verify the window closes and those Codex process trees no longer exist;
      the fixture repository's worktrees and branches must remain untouched.

## Release-test record

| Field                                        | Result |
| -------------------------------------------- | ------ |
| Candidate build                              |        |
| Windows / Codex CLI                          |        |
| Tester and date                              |        |
| Automated gate                               |        |
| Layout persistence and restore               |        |
| Two isolated Codex workspaces                |        |
| Removal, dirty cleanup refusal, and shutdown |        |
| Failures or follow-up                        |        |

T217 is complete only after every checkbox passes on the candidate package. Leave it
`in_progress` if an interactive check is pending or fails.
