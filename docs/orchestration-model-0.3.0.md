# Agenza 0.3.0 orchestration model

## Model boundaries

```text
ProjectWorkspaceContext
├─ source terminal and validated repository facts
├─ Orchestration
│  ├─ orchestrator Agent (planning thread, read-only)
│  ├─ TaskGraph
│  └─ worker AgentGraph
└─ existing WorkspaceService
   ├─ TerminalDefinition / TerminalSession
   └─ GitWorkspace / managed worktree catalog
```

- `ProjectWorkspaceContext` identifies the project that receives the goal. It is resolved in the
  main process from a current terminal assignment and fresh Git discovery.
- `Orchestration` owns one goal, limits, task graph, agent graph, and integration readiness state.
- `Task` is durable work independent from any runtime.
- `Agent` is a durable logical identity with a provider thread and optional terminal/worktree.
- `AgentRuntime` is the current provider process/thread/turn. It is never used as durable identity.
- `Terminal` remains the user's interactive process/view resource.
- `GitWorkspace` remains the branch/worktree resource assigned through `WorkspaceService`.

## Orchestration state

An orchestration contains:

```text
id, goal, status, project, options, orchestratorAgentId,
tasks, agents, integration, createdAt, startedAt, completedAt, error
```

States are `created`, `planning`, `running`, `reviewing`, `completed`, `failed`, and `stopped`.
Terminal states are final except that a later release may add an explicit resume operation.

`integration.status` is `not-ready`, `ready-for-review`, or `not-requested`. In 0.3.0 it records
readiness only; it does not mutate Git.

## Agent state

An agent contains:

```text
id, orchestrationId, name, role, provider, model, status,
taskId, terminalId, worktreeId, threadId, turnId, branch,
worktreePath, parentAgentId, createdAt, startedAt, completedAt,
result, error
```

States and allowed transitions:

```text
created -> starting -> working -> waiting -> working
                    |         \-> reviewing -> completed
                    |                       \-> failed
                    \-> failed
created|starting|working|waiting|reviewing -> stopped
```

The planning agent has no task, terminal, worktree, or branch. Worker agents have exactly one task
and, after provisioning, one exclusive worktree and one associated terminal definition.

## Task state and dependencies

A task contains:

```text
id, orchestrationId, title, description, role, status,
assignedAgentId, dependencies, priority, fileOwnership,
acceptanceCriteria, createdAt, startedAt, completedAt, result, error
```

States are `created`, `blocked`, `ready`, `starting`, `working`, `reviewing`, `completed`, `failed`,
and `stopped`.

The plan validator rejects duplicate IDs, unknown dependencies, self-dependencies, dependency
cycles, more tasks than `maxAgents`, empty tasks, and ownership entries that are absolute paths or
parent traversals. A task becomes `ready` only when every dependency is `completed`. A failed or
stopped dependency leaves its dependents `blocked`; it never starts them silently.

## Provider boundary

The orchestration service uses providers through a narrow contract:

```text
start(request) -> runtime snapshot
sendInstruction(agentId, instruction)
stop(agentId)
getStatus(agentId)
onEvent(listener)
dispose()
```

Provider events are normalized to `started`, `working`, `waiting`, `completed`, `failed`, and
`stopped`. Codex-specific thread, turn, and item payloads do not leak into scheduler logic or the
renderer.

`CodexAppServerProvider` owns one local App Server process and independent threads for the planner
and workers. It uses JSON-RPC initialization, `thread/start`, `turn/start`, streamed lifecycle
notifications, and `turn/interrupt`. Final agent messages become bounded result summaries; streamed
reasoning and command output are neither persisted nor logged.

## Event contract

Every event contains `sequence`, `timestamp`, `type`, `orchestrationId`, and a current immutable
orchestration snapshot. Optional `taskId`, `agentId`, `terminalId`, and `worktreeId` fields express
graph relationships directly.

Initial event names are:

```text
orchestrator:started
orchestrator:planning
orchestrator:running
orchestrator:reviewing
orchestrator:completed
orchestrator:failed
orchestrator:stopped
task:created
task:started
task:completed
task:failed
agent:created
agent:started
agent:status-changed
agent:completed
agent:failed
agent:stopped
worktree:created
integration:ready
```

The renderer consumes this domain stream and does not infer orchestration state from terminal
colors, PTY output, process IDs, or Git command output.

## Persistence and recovery

Orchestration state uses a separate schema-v1 JSON file and backup under the Agenza user-data
directory. Writes are serialized, validated, written to a temporary file, re-read, and atomically
renamed. A bounded history prevents unbounded local growth.

On application restart, `planning`, `running`, and `reviewing` orchestrations recover as `stopped`;
their non-final agents and tasks also become `stopped`. Their terminal definitions, worktree
assignments, branches, commits, and completed results remain untouched.

## Resource transaction

For each ready worker task:

```text
create Agent
  -> create TerminalDefinition
  -> plan branch/worktree from immutable base revision
  -> execute and verify Git worktree creation
  -> persist terminal assignment and managed ownership
  -> start provider thread/turn in that worktree
```

Failure before Git creation removes the unused terminal definition. Failure after verified Git
creation preserves the assigned terminal, worktree, branch, and ownership record for inspection.
Stopping an agent interrupts its turn but never invokes terminal removal, worktree cleanup, or
branch deletion.

## Integration boundary

When every task completes, `requireReview: true` moves the run through `reviewing` and records
`ready-for-review`; otherwise it records `not-requested`. The run then becomes `completed`.
Integration events, review agents, commit propagation, and merges can be added later without
changing task, agent, terminal, or worktree identity.
