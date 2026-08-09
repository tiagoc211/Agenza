# Changelog

All notable changes to Agenza are documented in this file.

## [0.1.0] - 2026-08-09

### Added

- Windows Electron application with two independent embedded Codex terminal panes.
- Independent project-folder selection, restart, clear, copy, and paste controls for each pane.
- Keyboard focus switching with `F6` and `Shift+F6` plus terminal-safe clipboard shortcuts.
- Secure Electron boundaries with sandboxed rendering, context isolation, validated IPC, and no
  renderer Node.js integration.
- Full process-tree cleanup on restart and application shutdown.
- Local structured diagnostics that exclude terminal content, commands, environment variables, and
  secrets.
- Unit, integration, packaged smoke, orphan-process, and release-artifact validation.
- Windows Squirrel installer and packaged application build.

### Changed

- Agenza launches the user's normal system `codex` command and does not require Conda at runtime.
- Conda environment `agenza` is retained only as the repository agent development workflow.

### Known limitations

- Windows only, with exactly two Codex-only terminal panes.
- Project-folder choices are not persisted between launches.
- Sessions cannot communicate with each other.
- The installer is not digitally signed and automatic updates are not configured.

[0.1.0]: https://github.com/tiagoc211/Agenza/releases/tag/v0.1.0
