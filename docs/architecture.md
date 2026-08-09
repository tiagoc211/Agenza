# Agenza 0.1.0 technical decision

## Decision

Agenza will be a Windows desktop application built with Electron and plain JavaScript. The first release will not use TypeScript, React, or another UI framework.

The selected stack is:

- Electron for the desktop application shell.
- Plain JavaScript, HTML, and CSS for the application and interface.
- `@xterm/xterm` for terminal rendering and input.
- `@xterm/addon-fit` for fitting each terminal to its pane.
- `node-pty` for two independent interactive Windows ConPTY processes.
- Electron Forge with its Webpack template for development and packaging.
- The Electron Forge Squirrel maker for the first Windows installer.
- npm for JavaScript package management.

Package versions will be pinned when the application is scaffolded in task `T003`.

## Architecture

The Electron renderer process will display two xterm.js instances. It will not receive direct access to Node.js, Electron, or operating-system APIs.

A preload script will expose a small, explicit API for terminal input, output, resize, restart, and cleanup. Electron context isolation and renderer sandboxing will remain enabled, and Node.js integration will remain disabled in the renderer.

The Electron main process will own two `node-pty` sessions. Each session will run Codex independently in the selected project folder. Output will be sent only to the matching terminal pane, and closing or restarting a session will terminate its complete child process tree.

```text
Renderer: xterm pane 1  <-- secure IPC -->  Main: PTY session 1  --> Codex
Renderer: xterm pane 2  <-- secure IPC -->  Main: PTY session 2  --> Codex
```

The terminal process layer uses one `TerminalSession` per PTY and a `TerminalManager` with the fixed IDs `terminal-one` and `terminal-two`. The manager routes input, output, resizing, and exit events by ID so one session cannot accidentally operate on the other. Before starting a pane, Agenza verifies that `codex --version` works in the user's normal system environment and then starts its Codex PTY from that same environment. The application does not activate or require Conda at runtime. A missing Codex installation or `PATH` entry produces a concise startup error in the affected pane.

The preload bridge exposes only terminal start, input, resize, output, and exit operations. The main process validates the sending frame, terminal ID, input type, and dimensions before routing any request. Renderer subscriptions are registered before the main process starts either PTY so initial shell output is not lost.

Each pane has an independent folder button backed by a narrow project-selection bridge and
Electron's native directory picker. The main process stores one folder per terminal ID and accepts
only absolute directories that can be read and written. A valid first selection starts only that
Codex session with the folder as `cwd`; a later selection stops and restarts only that session. Each
pane header displays its own full project path. Cancellation and validation errors leave the other
terminal untouched.

Session controls are scoped by the same fixed terminal IDs. For a running session, Clear sends the
standard Ctrl+L terminal control to the selected PTY so Codex clears the screen and redraws its input
at the correct cursor position. A stopped or not-yet-started pane is reset locally. Restarting asks
the main process to replace only the selected PTY. An unexpected exit disables input in that pane,
displays the exit status, and leaves its restart control enabled; the other pane continues running.

The renderer handles only unmodified F6 and Shift+F6 to cycle terminal focus. Combinations using
Ctrl, Alt, or Meta continue to the active xterm instance, preserving shell and Codex shortcuts. Each
xterm runs in screen-reader mode, session state changes use polite live regions, native buttons have
specific accessible names, and the pane containing keyboard focus receives the same strong visual
outline as the active pane.

On Windows, stopping a session uses the system `taskkill` executable with tree and force flags for
the PTY's root PID. This synchronously terminates Codex and any descendant shell processes before a
restart can create the replacement session. The same cleanup runs for both terminal managers on the
window's `close` event, before Electron exits. The regular node-pty kill remains a fallback when the
root process has already exited, and resource disposal attempts every session even if another
cleanup reports an error.

The packaged startup check creates a long-running descendant process in each PTY immediately before
closing its window. After the synchronous close cleanup, it checks both descendant PIDs and fails if
either still exists. This exercises the same window-close path used by the normal application.

The main process writes newline-delimited JSON diagnostics to `agenza.log` in Electron's local logs
directory. Logging is limited to application, window, IPC, and terminal lifecycle metadata. The
input and output routes never call the logger, sensitive field names are always redacted, token-like
values and control characters are sanitized, and logging failures do not stop the app. Terminal
startup and restart errors are caught per ID, logged without terminal content, and returned only to
the affected pane with a concise recovery instruction.

Automated validation has four entry points. `npm test` runs the Node test suite with faked PTY and
Electron boundaries. `npm run test:smoke` launches the packaged executable with `--startup-check`
and a 60-second timeout. `npm run test:all` runs the unit suite, packages the application, and then
runs the smoke test sequentially. The smoke check uses two real ConPTY sessions concurrently,
verifies isolated markers and restart behavior, exercises renderer controls and keyboard focus, and
confirms that persistent descendant processes do not survive window closure. After `npm run make`,
`npm run test:release` validates the Squirrel installer and package metadata plus the packaged
application archive, executable, and native ConPTY runtime.

`node-pty` remains external to the main Webpack bundle because it resolves native modules, worker
scripts, and helper scripts relative to its package directory. A build plugin copies its runtime
JavaScript and the current platform's prebuilt binaries into the Webpack output. Electron Forge
unpacks that complete runtime directory from the application archive so workers and native modules
can load from real filesystem paths.

## Why this stack

Electron lets the project use familiar web technologies while providing the native process and window APIs needed by a desktop application. xterm.js and node-pty are designed to work together: xterm.js handles terminal presentation, while node-pty provides the interactive pseudoterminal process.

Plain JavaScript keeps the first release approachable and avoids introducing a UI framework before the interface requires one. The main tradeoffs are Electron's larger application size and memory use, plus the native build and packaging requirements of `node-pty`. These are acceptable for the Windows-only personal release.

## User prerequisites

Running Agenza requires:

- Windows 10 version 1809 or newer, or Windows 11, for ConPTY support.
- An installed and authenticated Codex CLI whose `codex` command is available on the normal system `PATH`.

Conda is not an Agenza runtime requirement.

## Development prerequisites

Development requires:

- Windows 10 version 1809 or newer, or Windows 11, for ConPTY support.
- The Conda environment named `agenza`.
- Node.js and npm available inside that environment.
- The Codex CLI installed and authenticated on the system for interactive app testing.
- Git.
- Visual Studio Build Tools with the C++ workload if `node-pty` cannot use a compatible prebuilt binary.

The environment currently provides:

- Node.js `24.18.0`.
- npm `11.16.0`.
- Codex CLI `0.147.0`.

All agent project commands must follow the repository's `AGENTS.md` instructions and run through the `agenza` Conda environment. This development rule does not affect the environment used by the packaged application.

## Deferred decisions

The following choices are intentionally deferred until they are needed:

- A JavaScript UI framework.
- Support for operating systems other than Windows.
- Support for CLIs other than Codex.
- Communication between terminal sessions.
- Automatic application updates and code signing.
