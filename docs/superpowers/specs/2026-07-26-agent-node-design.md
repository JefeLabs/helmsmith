# agent-node: tmux-backed persistent agent sessions

**Date:** 2026-07-26
**Status:** Approved design (pre-implementation)
**Owner:** Edwin Cruz

## 1. Overview

agent-node runs interactive TUI agent CLIs (opencode, agy, copilot) inside
managed tmux sessions, drives them via `tmux send-keys`, reads each tool's
**persisted session files** as the output channel, and exposes every session
through the standard `AgentAdapter` interface from `@helmsmith/agent-adapter`.

Nodes run **in-process**, **in Docker**, or **on remote machines**. Sessions
outlive invocations, making `agent-node` the first adapter type with
`supportsSessionResume: true`.

### Drivers (all confirmed)

1. **Persistent warm sessions** — long-lived agent context across many
   commands; session resume, which no current adapter supports.
2. **Human attach/observe** — an operator can `tmux attach` to watch or take
   over any live session.
3. **Remote distribution** — sessions run on other machines; a broker routes
   commands to them.
4. **TUI-only tools** — tools without a usable headless/JSON mode (agy) become
   automatable.

### Non-goals

- Replacing the existing headless CLI adapters (`opencode-cli`,
  `copilot-cli`, …). Headless single-shot invocation stays where it is.
- Screen-scraping as a data path. tmux pane content is a diagnostic surface
  only; structured output always comes from session files.
- Autoscaling / capacity management beyond simple fleet routing (later).

## 2. Decisions log

| Decision | Choice |
|---|---|
| Output collection | Tail each tool's persisted session files; tmux is input-only |
| Broker | New standalone service (`agent-node-broker`), not part of harness-server |
| Node topology | One node manages N tmux sessions of mixed tools |
| Node enrollment | Hybrid: broker spawns in-process/Docker nodes; remote nodes self-register + heartbeat |
| Deployment targets | In-process, Docker, remote machine — same client contract |
| Profile storage | Broker profile registry (API + store); `ProfileStore` interface lets v1 run broker-less with a local file store |
| Persona vs voice | Separate profile fields: persona = role/behavior, voice = communication style |
| Adapter placement | Adapter + protocol ship in the agent-node packages; `agent-adapter-lib` is **not touched** (prerequisite: provider-externalization refactor — see companion spec `2026-07-26-adapter-provider-externalization-design.md`) |
| Transport | HTTP for control; newline-delimited JSONL over HTTP for chunk streaming (matches harness-server's pipeline-jsonl-stream precedent) |
| Session workspace | Per-session git worktree allocated by the engine (worktree pattern per harness-workspace.yml) |

## 3. Components and placement

| Piece | Location | Role |
|---|---|---|
| `'agent-node'` adapter, spec variant, capability descriptor, protocol schemas (zod) | `platform/harness/agent-node-server` — subpath entries `/adapter` and `/protocol` | Client. Implements `invoke()`/`stream()` over the `AgentNodeClient` interface. Hosts importing `/adapter` load no engine/daemon code. |
| `AgentNodeEngine` | new pkg `platform/harness/agent-node-server` | Tmux session lifecycle, per-tool drivers, session-file tailers, workspace materializer. Importable in-process; no network required. |
| Node daemon (`main.ts`) | same package | Wraps the engine with the HTTP API plus self-registration/heartbeat client. |
| Broker | new pkg `platform/harness/agent-node-broker` | Fleet registry, launchers, remote enrollment endpoint, command routing, response relay, profile registry. |

Dependency arrows all point at the lib **core**: `agent-node-server` and
`agent-node-broker` import `@helmsmith/agent-adapter` for the `AgentAdapter`
contract, chunk/stream types, and error taxonomy. After the
provider-externalization refactor (companion spec), `AgentSpecRegistry` is
open via declaration merging, so the agent-node package registers its
`'agent-node'` type and augments the spec union **from outside** —
agent-adapter-lib is not modified by this project.

## 4. Core interfaces

### AgentNodeClient (the seam)

One interface for talking to a node, two implementations:

- `LocalNodeClient` — direct calls into an in-process `AgentNodeEngine`.
  Lives with the engine (root entry of `agent-node-server`) and is
  **injected into the adapter via the spec** (`spec.client`) by the caller —
  this keeps the `/adapter` subpath free of engine code, so network-only
  hosts never load tmux machinery.
- `HttpNodeClient` — HTTP/JSONL to a broker or node daemon (Docker or
  remote). Lives in the `/adapter` entry (depends only on `/protocol`);
  selected when the spec carries `brokerUrl`/`nodeUrl`.

The adapter and the broker both consume this interface. Deployment target is
invisible above it.

Operations (shape, not final signatures): `ensureSession(profileRef,
sessionId?) → SessionHandle`, `send(sessionId, input) → AsyncIterable<AgentChunk>`,
`cancel(sessionId)`, `killSession(sessionId)`, `listSessions()`, `health()`.

### AgentNodeEngine

- Creates/kills tmux sessions (`tmux new-session -d -s <id>`), N sessions of
  mixed tools per node.
- Delegates tool specifics to a **driver** per tool (§5).
- Allocates a per-session workspace: a git worktree from the node's configured
  repo clone (in-process v1: a worktree of the adapter's `workdir`).
- Materializes the agent profile into the workspace before launch (§8).
- Input path: prompt text via `send-keys` (bracketed-paste/literal mode to
  survive newlines and special characters).
- Output path: tails the tool's session files, parses new structured
  messages, emits normalized `AgentChunk`s.
- Cancellation: `send-keys C-c` (SIGINT to the foreground TUI); escalate to
  `tmux kill-session` on timeout.

### Broker

- **Fleet registry:** nodes with id, address, tools available, capacity,
  liveness (heartbeat expiry marks a node dead).
- **Launchers:** `InProcessLauncher` (engine in the broker process),
  `DockerLauncher` (image with tmux + CLIs baked in, runs the daemon).
  Remote nodes are not launched — they self-register with a shared bearer
  token and heartbeat.
- **Routing:** command → node+session; response chunks relayed back to the
  calling adapter.
- **Profile registry:** CRUD API over `ProfileStore` (§8).

## 5. Per-tool drivers

Each driver owns five responsibilities:

1. **Launch** — command line, env, cwd to start the TUI in the session
   workspace; readiness probe (session file appears / pane settles).
2. **Discover** — locate the tool's persisted session storage for a session.
3. **Parse** — session-file format → normalized messages/chunks.
4. **Complete** — detect invocation completion from the session file (the
   assistant message is finalized), never from screen state.
5. **Materialize** — render an AgentProfile into the tool's native config
   surfaces (§8).

v1 ships the **opencode** driver (best-understood session storage; the lib
already carries opencode parsing knowledge). agy and copilot drivers follow
in v3. The agy driver's first task is characterizing its session-file format;
if agy persists nothing usable, agy support is re-scoped (pane-scrape
fallback is explicitly out of scope for this design).

## 6. Data flow

```
createAgent({ spec: { type: 'agent-node', profile: 'reviewer', sessionId? }, workdir })
  └─ adapter ── ensureSession ──► broker (or LocalNodeClient in v1)
                                    └─► node engine:
                                          allocate worktree
                                          materialize profile@hash
                                          tmux new-session, launch CLI, wait ready
invoke(input) ──► route to node+session ──► send-keys prompt
  tool writes session file ──► tailer parses new messages
  ──► AgentChunk stream ──► (relay) ──► adapter ──► reduceStream ──► AgentInvocationResult
```

The tmux session **outlives the invocation**. The returned `sessionId`
re-attaches on the next `createAgent`/`ensureSession` — that is session
resume. Profile changes never touch a live session (§8 pinning).

## 7. Capabilities row

Static row is conservative; the constructor refines per-tool from the
resolved profile — the same pattern `copilot-sdk` uses for
`supportsJsonMode`.

| Flag | Value | Note |
|---|---|---|
| `toolUseMode` | `'autonomous'` | The TUI runs its own tools |
| `supportsStreaming` | `true` | Message-level granularity (session-file tail), coarser than token deltas |
| `supportsSessionResume` | `true` | **First adapter type to support it** |
| `supportsCancellation` | `true` | `C-c` then `kill-session` |
| `supportsCapture` | `true` | The session file is the capture |
| `supportsJsonMode` | `false` | |
| `reportsUsage` | per-tool | opencode persists usage → true for opencode |
| `supportsExtendedThinking` | per-tool | true where the session file records reasoning |

## 8. Agent profiles

The unit of agent identity. What you spawn is an instance of a profile, not
"an opencode session".

```yaml
name: reviewer
tool: opencode
model: anthropic/claude-sonnet-5
persona: "You are the PR reviewer for JefeLabs..."   # role, duties, boundaries
voice: "Terse, direct, dry humor. Never uses emoji." # communication style
skills:                                              # skillzkit refs
  - jefelabs/code-review@1.x
context:                                             # copied into the workspace
  - path: docs/architecture.md
  - url: https://example.com/runbook.md
env: { }                                             # tool env, MCP config, permissions
```

- **persona vs voice** are separate fields so tone can be iterated (or later
  shared across roles) without touching role framing, and vice versa.
- **Materialization** renders the profile through the tool's *native* config
  surfaces in the session workspace: persona+voice into the instructions file
  (`AGENTS.md` / `CLAUDE.md` / tool equivalent), skillzkit-resolved skills
  into the tool's skills directory, context resources copied in as files,
  MCP/permissions into the tool's config file. No prompt injection through
  tmux; when the TUI starts, the agent already is that persona. (Interactive
  mode offers no reliable system-prompt flag; instructions files are the
  mechanism these tools honor.)
- **Storage:** the broker's **profile registry** is the source of truth,
  exposed as CRUD on the broker API. Every write produces an immutable
  content-hash version.
- **Pinning:** sessions pin `profile@hash` at creation. Editing a profile
  never mutates running sessions; a changed profile means a new session,
  because the old context was built under the old identity.
- **`ProfileStore` is an interface in the protocol layer.** Broker implements
  the API-backed store; v1 (broker-less) uses `LocalProfileStore` reading a
  directory of profile YAMLs. The v1 YAML files migrate into the registry via
  a one-shot import when the broker lands.
- The adapter spec references a profile (`profile: 'reviewer'` or
  `'reviewer@<hash>'`); tool and model are properties of the profile, not the
  spec. `AgentNodeSpec` has no `model` field (shape:
  `{ type: 'agent-node', profile, sessionId?, client? | brokerUrl? | nodeUrl? }`)
  and joins the spec union by augmenting `AgentSpecRegistry` from the
  agent-node package — the first externally-registered adapter type. Note this inverts the lib's usual flow: existing adapters push
  configuration through the API call (`AgentInput.systemPrompt`, `tools`);
  agent-node pushes it through the filesystem before launch. Per-invocation
  `systemPrompt` on a warm session is therefore ignored with a logged
  warning.

## 9. Error handling

Reuses the lib's existing taxonomy:

| Failure | Error |
|---|---|
| tmux or tool binary missing at engine/session start | `BinaryNotFoundError` |
| Broker or node unreachable | `NetworkError` (+ `classifyNetworkError`) |
| Tool-reported failure parsed from session file | `ProviderError` |
| Requesting a tool a node doesn't have | `CapabilityMismatchError` |
| Unknown profile / bad profile ref | `ConfigError` |
| Invocation timeout | cancel path; result `finishReason: 'aborted'` |

Node death: heartbeat expiry marks the node dead; its sessions surface as
typed errors to waiting adapters. The broker does **not** silently respawn —
a dead session's accumulated context is gone, and whether to rebuild it is
the caller's decision.

## 10. Testing

- **Parsers:** fixture session files per tool, mirroring the lib's existing
  `fixtures/*.jsonl` pattern.
- **Engine:** real tmux in tests (headless-scriptable), gated like the
  existing `live.test.ts` files.
- **Adapter:** conformance suite (`@helmsmith/agent-adapter/conformance`)
  against a stubbed `AgentNodeClient`.
- **Integration:** one gated end-to-end test — real tmux + real opencode,
  in-process engine.

## 11. Phasing

- **v0 — prerequisite:** the provider-externalization refactor of
  `agent-adapter-lib` (companion spec) lands first; it opens
  `AgentSpecRegistry` so agent-node can register externally.
- **v1 — in-process, broker-less:** `AgentNodeEngine` + opencode driver +
  `'agent-node'` adapter with `LocalNodeClient` + `LocalProfileStore`.
  Delivers persistent resumable opencode sessions with profiles, usable from
  harness-server immediately.
- **v2 — daemon + Docker:** daemon mode (HTTP/JSONL API), `HttpNodeClient`,
  `DockerLauncher`, worker image with tmux + CLIs.
- **v3 — broker + fleet:** `agent-node-broker` (fleet registry, hybrid
  enrollment with bearer-token self-registration, routing, profile registry
  API + import from v1 YAML), agy and copilot drivers.

The `AgentNodeClient` and `ProfileStore` interfaces are the seams that make
each later phase additive rather than a rewrite.
