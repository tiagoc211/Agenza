# Agenza 0.1.0

Agenza `0.1.0` is the first public Windows release. It provides one local desktop window with two
independent Codex CLI terminals so two project workflows can run side by side.

## Highlights

- Run two isolated Codex sessions at the same time.
- Select and change a different project folder for each pane.
- Copy, paste, scroll, resize, clear, restart, and switch keyboard focus independently.
- Keep the unaffected pane running when the other Codex process exits or fails.
- Terminate both complete process trees when Agenza closes.
- Store safe local diagnostics without terminal input, output, commands, or secrets.

## Install

1. Download `Agenza-0.1.0 Setup.exe` from this release.
2. Run the installer and open Agenza.
3. Choose a project folder in each terminal pane.

Windows may show a SmartScreen warning because the `0.1.0` installer is not digitally signed. Only
run the installer downloaded from the official Agenza GitHub Release.

## Requirements

- Windows 10 version 1809 or newer, or Windows 11.
- Codex CLI installed and authenticated.
- `codex --version` working in a normal terminal.

Conda, Node.js, and npm are not required to run the installed app.

## Release verification

The release workflow runs the complete unit and integration suite, creates a fresh package, performs
a two-terminal packaged smoke test, checks for orphaned process trees, builds the Squirrel installer,
and validates every release artifact.

## Known limitations

- Windows only.
- Exactly two terminal panes and Codex is the only supported CLI.
- Project folders are selected again on every launch.
- No communication between sessions, accounts, Agenza cloud sync, or shared workspaces.
- No code signing or automatic updates.

See [README.md](../README.md) for usage and troubleshooting, and
[CHANGELOG.md](../CHANGELOG.md) for the complete change summary.
