# Agenza 0.1.0 manual release test

Run this checklist against the packaged Windows application. Record failures with the affected terminal, the action performed, and the relevant lines from `%APPDATA%\Agenza\logs\agenza.log`.

## Automated release checks

- [x] `npm run test:all` passes (37/37 tests on 2026-08-09).
- [x] The packaged smoke test passes three consecutive open/close cycles.
- [x] No child shell processes remain after those cycles.

## Two independent Codex sessions

- [x] Open Agenza and choose a different valid project folder for each terminal.
- [x] In terminal 1, ask Codex to reply exactly with `TERMINAL_ONE_OK`.
- [x] At the same time, ask terminal 2 to reply exactly with `TERMINAL_TWO_OK`.
- [x] Confirm that both replies appear only in the terminal where they were requested.
- [x] Change the project folder of one terminal and confirm the other terminal is unaffected.

## Terminal interaction

- [x] Type, select, copy, and paste text in both terminals.
- [x] Produce enough output to scroll, then scroll up and back to the current prompt.
- [x] Resize the app and confirm both terminals remain usable and correctly fitted.
- [x] Use `F6` and `Shift+F6` to move focus between terminals.
- [x] Clear one terminal and confirm its prompt returns to the top while the other is unchanged.
- [x] Restart one terminal and confirm the other Codex session remains active.

## Failure and shutdown behavior

- [x] Start Agenza with `--missing-codex-check`, choose a folder, and confirm that the pane explains how to make Codex available without crashing the app.
- [x] Exit or interrupt one terminal process and confirm that its pane shows the exit and offers Restart.
- [x] Restart that terminal and confirm it can run Codex again while the other terminal remains active.
- [x] Close Agenza with both terminals running and confirm the window exits normally.

T014 is complete only after every item above passes. Keep it `in_progress` if any item is pending or fails.
