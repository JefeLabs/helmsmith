# agent-adapter — Full PRD Rebuild: Program Plan

**Status:** roadmap — awaiting sign-off, then per-phase detailed plans + subagent-driven execution
**Branch:** `agent-adapter-prd-rebuild` (off `main`) — the rebuild is BREAKING (32+ consumers can't compile against a half-migrated lib), so it lives on one branch and merges only when the whole monorepo is green together.
**Design source:** `.plans/2026-04-30-prd-agent-adapter-lib.md` (the target API) + the gap analysis (current → PRD deltas).
**Real names (the PRD uses placeholders):** package `@helmsmith/agent-adapter` at `core/agent-adapter-lib/`; sibling `@helmsmith/agent-auth` at `core/agent-auth-lib/`. NOT `@your-org` / `npm-dependency/`.

## Conventions (match the repo — verified)
- TS ESM, Node ≥20, `moduleResolution: Bundler`, **explicit `.ts` import extensions** everywhere, `"type": "module"`, target ES2022, strict.
- **Biome** for lint+format (`pnpm lint` = `biome lint .`, `pnpm format`, `pnpm check`). NOT eslint/prettier.
- **Vitest**, tests **colocated** in `src/` as `*.test.ts`; `vi.mock`/`vi.fn`, dynamic `await import()` for mock-before-load, a `fakeChild()` EventEmitter pattern for `child_process.spawn`. (PRD's `test/` + `fixtures/` dirs → adapt to colocated + an inline fixtures module.)
- Root: `pnpm typecheck` (`-r`), `pnpm test` (root vitest discovery), `pnpm build` (`-r`). Add a per-package `vitest.config.ts` only if needed for the conformance suite.
- Single-spawn invariant; no MCP; no retries; no tmux/fan-out in adapters (PRD §3, §9, D8).

## Adapter taxonomy: transport × mode (SDK chat|agent, + CLI)
Adapters are organized on two axes — **transport** (`sdk` in-process vs `cli` subprocess) and, for SDK, **mode** (`chat` single-shot vs `agent` autonomous tool-loop):

| Provider | SDK · chat | SDK · agent | CLI |
| --- | --- | --- | --- |
| Claude | `claude-sdk` (`@anthropic-ai/sdk` `messages`) — no autonomous tools | **`claude-agent-sdk`** (`@anthropic-ai/claude-agent-sdk` `query()`) — in-process autonomous tools | `claude-code-cli` (spawn `claude`) |
| OpenCode | — | — | `opencode-cli` |
| Copilot | `copilot-sdk` (HTTP, OpenAI-compatible; host-loop tools) | — | `copilot-cli` (gh, limited) · agentic `copilot` |
| OpenAI | `openai` (v1.1) | — | — |

`AgentSpec` carries `transport`/`mode` (or distinct `type`s — decided in Phase A). The **agent-SDK is the cleanest in-process tool-using runtime** (structured tool events, no subprocess) and is the recommended default for the uxfactory worker; `claude-code-cli` is the subprocess equivalent.

## Capability metadata + listing (incorporated per request)
The registry carries a **static `AdapterCapabilities` descriptor per `AgentSpecType`** (the PRD §8.7 matrix encoded as data, extended with the chat/agent split). New query: `listAdapterTypes(filter?: Partial<AdapterCapabilities>): AgentSpecType[]` — filter the runtime OPTIONS by capability before constructing (e.g. `{supportsToolUse:true}` → the agent-SDK + all CLI + copilot-sdk; EXCLUDES `claude-sdk` chat + `copilot-cli`). Construction can refine model-dependent caps (copilot `supportsJsonMode`); the static descriptor is the declared default. This is the metadata a host UI / the uxfactory worker uses to pick a runtime.

## Testability on this machine
- **Live-testable:** `claude` v2.1.195 (claude-code-cli), `opencode` v1.17.5 (opencode-cli), `@anthropic-ai/claude-agent-sdk` v0.3.195 + `@anthropic-ai/sdk` (claude-sdk). Copilot-sdk = HTTP (mockable via `fetchFn`).
- **Fixture-only here:** the agentic `copilot` CLI is NOT installed (`gh copilot` is the limited suggest/explain one). The agentic-copilot adapter is built-to-spec against canned stdout fixtures + a skipped live test until the binary exists.

## The three dependency risks → the phase ordering
1. **Consumer cascade (32+ files):** `harness-core/orchestrator`+`job-bus`, `harness-server/*`, `harness-pipeline-cli`, `context-loader-core`, `apps/pritty`, integration tests — all consume `invoke({system,user}):Promise<string>`. → migrated in Phase F, all at once, on the branch.
2. **Copilot auth inversion:** the GitHub→Copilot token exchange must move INTO `agent-auth-lib` before `copilot-sdk` can be broker-mediated. → **Phase 0 (agent-auth first).**
3. **LangGraph extrication:** `LangGraphAdapter`/`HarnessChatModel` (consumed by harness-server) + the `@langchain/*` runtime deps must leave the lib (PRD D4). → a companion package + harness migration in Phase F.

---

## Phase roadmap (each phase gets its own detailed TDD plan before execution)

### Phase 0 — agent-auth-lib: Copilot token exchange (prerequisite; Risk 2)
Move the GitHub-OAuth→Copilot-session-token exchange + refresh out of `CopilotChatAdapter` into `agent-auth-lib` so `broker.getCredential('github-copilot')` returns an already-exchanged, auto-refreshed Copilot token. Widen `CredentialBroker.getCredential` to accept `string` (or keep `Provider` + a cast seam) so the adapter lib's structural broker copy is assignable. Deliverable: agent-auth exposes broker-mediated Copilot creds; its tests green.

### Phase A — agent-adapter core scaffold (PRD Phase A)
New modules: `types.ts` (`AgentSpec` union, `AgentInput{messages,systemPrompt,tools,toolChoice}`, `AgentInvocationResult{content,contentBlocks,usage,finishReason,capture,durationMs}`, `AgentAdapter{type,capabilities,workdir,invoke,stream}`, `InvokeOptions`, `ChatMessage`/`ContentBlock`/`ToolDefinition`), `capabilities.ts` (+ the static per-type descriptors + `listAdapterTypes` filter), `stream.ts` (`AgentChunk` taxonomy + stream↔result reduction), `errors.ts` (refactor: keep the good `AdapterError` taxonomy + add `WorkdirNotARepoError`/`BinaryNotFoundError`/`MissingCredentialError`/`CapabilityMismatchError`), `registry.ts` (`registerAdapter` + built-ins), `create-agent.ts` (the factory: validates `workdir` is a git tree, resolves repo metadata, capability-mismatch check, dispatches by `spec.type`), `credentials/broker.ts` (structural `CredentialBroker` copy → drop the hard `@helmsmith/agent-auth` dep), `adapters/shared/child-process.ts` (spawn/stdio/abort/version-check, extracted). Keep `AgentEvent`/`AdapterEventBus` INTERNAL (observability) — off the public `AgentAdapter` interface.

### Phase B — Claude SDK adapters: chat + agent (PRD §8.1 + the agent-SDK extension)
**B1 `claude-sdk` (chat):** refactor the existing `ClaudeSdkAdapter` to the new shape — `invoke(AgentInput)→AgentInvocationResult` + `stream()→AsyncIterable<AgentChunk>` over `client.messages.stream` (`@anthropic-ai/sdk`), API tool-use blocks → `tool-call-*` chunks (host runs the loop — NOT autonomous), usage/finishReason, `workdir` metadata, AbortSignal. Caps: `supportsToolUse:true` (host-loop), `supportsJsonMode:false`, `supportsSessionResume:false`. (Remove the hardcoded `max_tokens:256` — drive from `spec`.)
**B2 `claude-agent-sdk` (agent):** NEW in-process autonomous adapter on `@anthropic-ai/claude-agent-sdk` (v0.3.195) `query()` — built-in file+shell tools, the agentic loop runs IN-PROCESS, tool calls surfaced as `tool-call-*` chunks (observability; autonomous like the CLIs). `workdir` → the query cwd; creds via broker → `ANTHROPIC_API_KEY`. Caps: `supportsToolUse:true` (autonomous), streaming, usage, cancellation. This is the recommended in-process skill-runner. Add `@anthropic-ai/claude-agent-sdk` as a peer-optional dep.
Both pass conformance (echo, multi-turn, abort, usage); B2 also the tool-use scenario.

### Phase C — `claude-code-cli` adapter (PRD §8.2) — THE one uxfactory needs
New: spawn `claude --print --output-format=stream-json --input-format=stream-json`, `$HOME`/`$TMPDIR` sandboxed to `workdir`, `ANTHROPIC_API_KEY` injected via env from the broker (validated at construct → `MissingCredentialError`), `stream-parser.ts` (line-buffered stream-json → `AgentChunk`), `flags.ts` (`AgentSpec`→flags), built-in tools surfaced as `tool-call-end` (observability). Fixture tests (canned stdout) + a live integration test (gated on the `claude` binary). Passes the conformance suite.

### Phase D — `opencode-cli` adapter (PRD §8.3)
Rebuild the existing `OpenCodeCliAdapter` to the new shape via `shared/child-process.ts`, add stream-json parsing + the sandbox + `AgentChunk` emission; PRESERVE its current strengths (local-endpoint mode, XDG config isolation, `--attach` serverUrl, provider env injection). Verify the §8.7 TBD caps (usage, thinking) against `opencode` v1.17.5. Passes conformance.

### Phase D′ — Copilot + agentic-copilot adapters (PRD §8.4–8.5)
`copilot-sdk` (HTTP, OpenAI-compatible `normalize.ts` + hardcoded contract `headers.ts` + `sse-parser.ts`; broker-mediated creds from Phase 0; custom tool-use forwarding); `copilot-cli` (`gh copilot suggest` — LIMITED: no tool-use/stream, `skipScenarios` in conformance — the reference "limited adapter"); **agentic `copilot` adapter** (the standalone autonomous CLI — built-to-spec against fixtures, live test skipped until the binary is installed). 

### Phase E — Conformance suite (the keystone, PRD §5/D5)
`src/conformance/` exported as `@helmsmith/agent-adapter/conformance`: scenarios (echo, multi-turn, abort, tool-use, malformed) + the limited-adapter skip path. One `*.test.ts` drives every built-in adapter through it. This is the swap-compatibility guarantee.

### Phase F — Consumer migration + LangGraph extrication (Risk 1 + Risk 3)
Migrate all 32+ consumers from `invoke({system,user}):string` to `invoke(AgentInput):AgentInvocationResult` (named: harness-core orchestrator/job-bus, harness-server, harness-pipeline-cli, context-loader-core, apps/pritty + their integration tests). Move `LangGraphAdapter`+`HarnessChatModel` to a companion `@helmsmith/agent-adapter-langchain` (or into harness-server) and drop `@langchain/*` from the lib. The whole monorepo typechecks + tests green on the branch.

### Phase G — Ship
README quickstart, capability matrix doc, `mountAgentCommand` helper (optional), final `pnpm -r typecheck && test && check` green → merge `agent-adapter-prd-rebuild` → `main`.

---

## After this program: back to uxfactory
With `@helmsmith/agent-adapter` rebuilt + the `claude-code-cli`/opencode/agentic-copilot adapters shipping, resume **Phase 11B** (the uxfactory worker + bridge relay) on the real, pluggable, capability-filterable adapters — then **Phase 11A** (the plugin pipeline panel).

## Open confirmations before Phase 0
1. **Consumer migration is in-scope** (Risk 1) — yes, accepted with the blast radius.
2. **LangGraph extrication** — companion package `@helmsmith/agent-adapter-langchain` vs absorb into harness-server? (Phase F detail.)
3. **`workdir` for chat/HTTP adapters** — the PRD requires a git working tree even for SDK/HTTP adapters; confirm OK (it's just metadata for them).
