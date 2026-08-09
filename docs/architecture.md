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

The terminal process layer uses one `TerminalSession` per PTY and a `TerminalManager` with the fixed IDs `terminal-one` and `terminal-two`. The manager routes input, output, resizing, and exit events by ID so one session cannot accidentally operate on the other. Until Codex launching is added in `T007`, the default interactive process is PowerShell.

The preload bridge exposes only terminal start, input, resize, output, and exit operations. The main process validates the sending frame, terminal ID, input type, and dimensions before routing any request. Renderer subscriptions are registered before the main process starts either PTY so initial shell output is not lost.

`node-pty` remains external to the main Webpack bundle because it resolves native modules, worker
scripts, and helper scripts relative to its package directory. A build plugin copies its runtime
JavaScript and the current platform's prebuilt binaries into the Webpack output. Electron Forge
unpacks that complete runtime directory from the application archive so workers and native modules
can load from real filesystem paths.

## Why this stack

Electron lets the project use familiar web technologies while providing the native process and window APIs needed by a desktop application. xterm.js and node-pty are designed to work together: xterm.js handles terminal presentation, while node-pty provides the interactive pseudoterminal process.

Plain JavaScript keeps the first release approachable and avoids introducing a UI framework before the interface requires one. The main tradeoffs are Electron's larger application size and memory use, plus the native build and packaging requirements of `node-pty`. These are acceptable for the Windows-only personal release.

## Local prerequisites

Development requires:

- Windows 10 version 1809 or newer, or Windows 11, for ConPTY support.
- The Conda environment named `agenza`.
- Node.js and npm available inside that environment.
- The Codex CLI installed and authenticated.
- Git.
- Visual Studio Build Tools with the C++ workload if `node-pty` cannot use a compatible prebuilt binary.

The environment currently provides:

- Node.js `24.18.0`.
- npm `11.16.0`.
- Codex CLI `0.147.0`.

All project commands must follow the repository's `AGENTS.md` instructions and run through the `agenza` Conda environment.

## Deferred decisions

The following choices are intentionally deferred until they are needed:

- A JavaScript UI framework.
- Support for operating systems other than Windows.
- Support for CLIs other than Codex.
- Communication between terminal sessions.
- Automatic application updates and code signing.
