# Agenza

Agenza is a personal desktop app for working on projects with AI coding tools.

The first version will be intentionally simple: it will let us open and use two terminals, each running the Codex CLI.

Later, Agenza may support more CLI tools and allow them to work together. For now, the goal is to build a small, useful foundation and improve it step by step.

The first release will use Electron with plain JavaScript, HTML, and CSS. See the [technical decision](docs/architecture.md) for the complete stack, architecture, and development prerequisites.

## First milestone

- Open two terminals in one app.
- Run the Codex CLI in both terminals.
- Use both terminals independently.

## Development

Run every project command inside the `agenza` Conda environment. If Conda is not initialized in PowerShell, use its full executable path as described in `AGENTS.md`.

```powershell
conda run -n agenza npm install
conda run -n agenza npm run dev
```

Each terminal pane has its own folder button. Choose a readable and writable project folder to start
that pane's Codex session; the two panes may use different folders. Choosing another folder later
restarts only that pane in the new directory. Agenza checks that Conda can run Codex from the
`agenza` environment before each session starts. Each pane also has its own **Clear** and **Restart**
controls. Clear removes visible terminal output without stopping Codex, while Restart replaces only
that pane's session. If Codex exits unexpectedly, the affected pane shows the exit and keeps its
Restart action available. Press **F6** to focus the other terminal or **Shift+F6** to move in the
opposite direction. Agenza leaves standard terminal shortcuts, including copy and paste, untouched.

Available validation and build commands are:

```powershell
conda run -n agenza npm test
conda run -n agenza npm run test:smoke
conda run -n agenza npm run test:all
conda run -n agenza npm run lint
conda run -n agenza npm run format:check
conda run -n agenza npm run build
conda run -n agenza npm run make
```

`npm test` runs the fast unit and integration suite. `npm run test:smoke` runs the already-built
Windows package and verifies two concurrent, isolated PTYs, restart, keyboard focus, output clearing,
window cleanup, and orphan detection. `npm run test:all` runs the unit suite, creates a fresh package,
and then runs that smoke test in sequence.

JavaScript dependencies are recorded in `package.json` and `package-lock.json`. `requirements.txt` is reserved for any future Python tooling.

## Diagnostics

Agenza stores structured diagnostics in `agenza.log` inside Electron's local logs directory (normally
`%APPDATA%\Agenza\logs` on Windows). The log records application and terminal lifecycle events,
terminal IDs, process IDs, exit codes, and sanitized error summaries. It never records terminal
input, terminal output, commands, environment variables, or authentication secrets. Startup and
session errors also appear in the affected window with a short recovery action.

## Release 0.1.0 scope

The first release targets Windows. Agenza will be a local-only, single-user desktop app with no Agenza account, remote backend, or cloud synchronization. The Codex CLI may still use its own online services as normal.

For release `0.1.0`, users will be able to:

- Select a local project folder.
- Open two embedded terminal panes for that project.
- Run one independent Codex CLI session in each pane.
- Type, scroll, copy, paste, resize, clear, and restart each terminal.
- Close Agenza without leaving Codex or shell processes running.

The first release is complete when these workflows work in a packaged Windows build, failures provide useful error messages, and the release checks pass.

## Not included in release 0.1.0

- Linking agents or allowing sessions to communicate with each other.
- CLI tools other than Codex.
- Multiple users, user accounts, or shared workspaces.
- An Agenza cloud service, remote storage, or cloud synchronization.
- Mobile, web, macOS, or Linux versions.
