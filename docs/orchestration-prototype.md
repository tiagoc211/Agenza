# Local orchestration and inter-agent communication prototype

This document describes the experimental control plane on the `test-comm-inter-term` branch. It is
not part of the Agenza `0.2.0` release contract. The prototype exists to test how independent Codex
terminals can communicate while the Electron main process remains the only authority for process
and workspace lifecycle.

## Functional flow

1. Assign folders or Git worktrees to at least two terminals and start Codex in them.
2. Open **Orchestrator** in the application header.
3. Select one connected terminal and choose **Set orchestrator**. Agenza sends that Codex session a
   short description of the available control commands.
4. Select one agent or **All agent instances**, write an order, and choose **Send order**. Connected
   targets receive the message directly in their PTY; stopped targets retain it in an in-memory
   mailbox.
5. Use **Create agent** and **Remove target** from the panel, or let the selected Codex orchestrator
   invoke the same lifecycle through `agenza-agent`.

Every Agenza-launched Codex process receives this local command in its `PATH`:

```powershell
agenza-agent whoami
agenza-agent list
agenza-agent send <terminal-id|all> <message>
agenza-agent inbox
agenza-agent create
agenza-agent remove <terminal-id>
```

All agents may list instances, send messages, and read their own inbox. Only the currently selected
orchestrator may use `create` or `remove`. A new instance is deliberately unassigned; the user must
still choose its ordinary folder or isolated Git worktree in the Agenza interface before Codex can
start. The orchestrator cannot remove its own terminal.

## Communication boundary

```text
Codex agent / Orchestrator panel
             |
             | authenticated intent (ephemeral per-terminal token)
             v
Electron main: OrchestrationService on 127.0.0.1:<random port>
             |
             +--> WorkspaceService: create/remove terminal definition
             +--> TerminalManager: deliver a message to one connected PTY
             +--> memory-only mailbox: retain up to 100 messages per agent
             |
             v
Renderer receives lifecycle metadata only and adds/removes the matching pane
```

The broker binds only to IPv4 loopback on a random operating-system-selected port. Each terminal
gets an independent random bearer token through its process environment. Tokens are not returned
to the renderer, persisted, or logged. The generated PowerShell wrapper contains no token. Message
contents remain in process memory and terminal input only; lifecycle events contain IDs and
snapshots, never message text.

Terminal removal keeps the existing Agenza safety contract: it stops and removes only that terminal
definition. Project folders, Git worktrees, registrations, branches, and the managed-worktree
catalog remain untouched.

## Prototype limitations

- The orchestrator creates an unassigned pane; it does not choose or create a Git workspace.
- Mailboxes are not durable and disappear when Agenza closes.
- Direct delivery queues text in the Codex TUI but does not infer task completion or parse model
  output.
- There is no dependency graph, retry policy, consensus, automatic merge, or conflict resolution.
- Selecting an orchestrator is runtime-only and must be repeated after restarting Agenza.
- This local CLI bridge is an experiment. A production design should evaluate a packaged MCP
  server, explicit tool approvals, durable task state, and stronger audit semantics before merging
  orchestration into a release branch.
