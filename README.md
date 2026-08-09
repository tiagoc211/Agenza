# Agenza

Agenza is a local Windows desktop workspace for running two independent Codex CLI sessions. Each
terminal can use a different project folder and can be controlled without affecting the other one.

Release `0.1.0` uses Electron, plain JavaScript, xterm.js, and node-pty. See
[docs/architecture.md](docs/architecture.md) for the technical design.

## User requirements

- Windows 10 version 1809 or newer, or Windows 11.
- An installed and authenticated Codex CLI.
- The `codex` command available in a normal terminal. Verify it with `codex --version`.

Agenza runs Codex from the user's normal system environment. Users do not need Conda, Node.js, or
npm to run the installed application.

## Install

Download `Agenza-0.1.0 Setup.exe` from the Agenza `0.1.0` GitHub Release and run it. Open Agenza
after setup finishes.

The `0.1.0` installer is not digitally signed, so Windows may show a SmartScreen warning. Only run
an installer downloaded from the project's own GitHub Release. Code signing is deferred to a future
release.

## Use Agenza

1. Open Agenza.
2. Select a project folder independently in each terminal pane.
3. Wait until each pane shows **Connected**, then use Codex normally.
4. Close the Agenza window when finished; both Codex process trees are terminated.

Each pane provides these controls:

- **Change folder** restarts only that pane in the newly selected directory.
- **Copy** copies the current terminal selection.
- **Paste** pastes clipboard text once into that terminal.
- **Clear** clears the visible screen without stopping Codex.
- **Restart** replaces only that pane's Codex process.
- **F6** and **Shift+F6** move keyboard focus between panes.
- **Ctrl+C** copies when text is selected; without a selection, it interrupts Codex.
- **Ctrl+V** pastes into the active terminal.

Project folders are selected again whenever Agenza starts; they are not persisted in `0.1.0`.

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

The `0.1.0` release was tested with Conda `25.11.1`, Node.js `24.18.0`, npm `11.16.0`, and Codex CLI
`0.147.0`. Codex `0.147.0` is a tested version, not a pinned runtime requirement.

Install dependencies and start the development app:

```powershell
conda run -n agenza npm install
conda run -n agenza npm run dev
```

For the shortest non-Conda instructions, see [HOWTORUN.md](HOWTORUN.md).

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

- `npm test` runs the fast unit and integration tests.
- `npm run test:smoke` exercises two packaged ConPTY sessions, isolation, controls, restart, focus,
  shutdown, and orphan detection.
- `npm run test:all` runs the unit suite, creates a fresh package, and runs the smoke test.
- `npm run build` creates an unpacked application under `out/Agenza-win32-x64`.
- `npm run make` creates the Windows Squirrel installer and package under
  `out/make/squirrel.windows/x64`.
- `npm run test:release` checks that the installer, Squirrel metadata, application archive,
  executable, and native ConPTY runtime are present and complete.

The generated `out/` directory is intentionally ignored by Git. Release installers are attached to
a GitHub Release instead of being committed to the repository.

## Diagnostics

Agenza stores newline-delimited JSON diagnostics in `%APPDATA%\Agenza\logs\agenza.log`. Logs include
application and process lifecycle metadata, but never terminal input, terminal output, commands,
environment variables, or authentication secrets.

An error in one pane is shown locally and does not stop the other pane.

## Troubleshooting

### Codex CLI was not found on PATH

Open a normal terminal and run `codex --version`. Install or repair Codex if the command fails. If it
works in the terminal, fully close and reopen Agenza so the desktop app receives the updated `PATH`.

### A project folder cannot be used

Choose an existing absolute directory that the current Windows user can read and write. An error or
canceled selection in one pane does not change the other pane.

### Codex exited unexpectedly

Use **Restart** in the affected pane. The other session should remain active. Check
`%APPDATA%\Agenza\logs\agenza.log` if the process repeatedly exits.

### The app is blank or unresponsive

Close Agenza and open it again. If the problem continues, rebuild or reinstall the app and inspect
the diagnostic log.

### A build reports that conpty.node is locked

Close every running Agenza window and any `npm run dev` process, then run the build again. A running
Electron development instance keeps the native node-pty module open on Windows.

### Windows warns about the installer

Release `0.1.0` is not code-signed. Confirm that the file came from the project's own GitHub Release
before choosing to run it.

## Known limitations in 0.1.0

- Windows only.
- Exactly two fixed Codex terminal panes.
- Codex is the only supported CLI.
- Project-folder choices are not saved between app launches.
- Sessions cannot communicate or coordinate with each other.
- No accounts, remote backend, Agenza cloud sync, or shared workspaces.
- No automatic updates or code signing.
- Codex must be installed and authenticated separately and may use its own online services.

The manual release checklist is recorded in
[docs/manual-release-test.md](docs/manual-release-test.md).

Release history is available in [CHANGELOG.md](CHANGELOG.md), with the `0.1.0` publication text in
[docs/release-notes-0.1.0.md](docs/release-notes-0.1.0.md).
