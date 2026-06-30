# Phase A — agent-adapter core scaffold (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated `*.test.ts`, `moduleResolution: Bundler`.

## COEXISTENCE RULE (load-bearing)
This branch is a breaking rebuild with 32+ consumers. To keep every phase GREEN + reviewable, Phase A–E build the NEW surface in NEW files ALONGSIDE the old. **Do NOT modify `index.ts` (keep the current exports), the old adapter files (`claude-sdk-adapter.ts`, `opencode-cli-adapter.ts`, `copilot-chat-adapter.ts`, `openai-chat-adapter.ts`, `langgraph-adapter.ts`, `harness-chat-model.ts`, `binding-to-adapter.ts`, `opencode-server.ts`), or the old `types.ts`/`events.ts`.** The ONLY existing file Phase A edits is `errors.ts` (ADDITIVE — new classes only). Phase F flips `index.ts` to the new surface + deletes the old + migrates consumers. Until then the old lib keeps compiling and consumers are untouched.

New core types live in `src/agent.ts` (NOT `types.ts`, which is occupied by the old `InvocationSpec`). Phase F renames/consolidates.

## Reference
PRD `.plans/2026-04-30-prd-agent-adapter-lib.md` §7 (Core Types — use the interfaces verbatim), §8.7 (capability matrix → the static descriptors), §9 (child-process). The program plan's taxonomy table (SDK chat|agent + CLI; `AgentSpecType` is the discriminator).

## Deliverables (new files unless noted)

### `src/agent.ts` — the public types (PRD §7)
`AgentSpecType = 'claude-sdk' | 'claude-agent-sdk' | 'claude-code-cli' | 'opencode-cli' | 'copilot-sdk' | 'copilot-cli' | 'copilot-agent-cli'` (the agentic copilot; `openai` reserved). `AgentSpec` discriminated union on `type` (each carries `model`, optional `systemPrompt`, `binaryPath?`/`env?` for CLI, `apiKey?` for pre-resolved). `AgentInput { messages: ChatMessage[]; systemPrompt?; tools?: ToolDefinition[]; toolChoice? }`, `ChatMessage { role; content }`, `ContentBlock`, `ToolDefinition`, `InvokeOptions { signal?; timeoutMs?; capture? }`, `AgentInvocationResult { content; contentBlocks?; usage?; finishReason?; capture?; durationMs }`, `TokenUsage`, `AgentCapture`. `AgentAdapter { readonly type; readonly capabilities; readonly workdir; invoke(input, opts?): Promise<AgentInvocationResult>; stream(input, opts?): AsyncIterable<AgentChunk> }`. `CreateAgentArgs { spec; workdir; credentialBroker?; logger?; signal? }`.

### `src/stream.ts` — `AgentChunk` + reduction (PRD §7 chunks, §10)
The `AgentChunk` union (text-delta, thinking-delta, tool-call-start/input/end, tool-result, message-stop, usage, error). `reduceStream(chunks: AsyncIterable<AgentChunk>): Promise<AgentInvocationResult>` — concatenates text-deltas → `content`, builds `contentBlocks`, pulls final `usage`/`finishReason`; this is how `invoke` is implemented from `stream` (guarantees parity). A small push-queue `AsyncIterable` helper (cap 1000, drop text-deltas with a warn under backpressure; never drop tool/stop).

### `src/capabilities.ts` — descriptors + `listAdapterTypes` (the requested feature)
`AdapterCapabilities { reportsUsage; supportsStreaming; supportsToolUse; supportsExtendedThinking; supportsCancellation; supportsCapture; supportsJsonMode; supportsSessionResume }`. A static `CAPABILITY_MATRIX: Record<AgentSpecType, AdapterCapabilities>` encoding PRD §8.7 + the chat/agent split: `claude-sdk` (chat — toolUse:true host-loop, jsonMode:false), `claude-agent-sdk` (autonomous tools, streaming, usage, thinking), `claude-code-cli`/`opencode-cli` (autonomous tools), `copilot-sdk` (custom tools, jsonMode model-dependent default false), `copilot-cli`/`copilot-agent-cli` (cli: copilot-cli toolUse:false/stream:false). `listAdapterTypes(filter?: Partial<AdapterCapabilities>): AgentSpecType[]` — returns the types whose descriptor matches every filter key. `intersectCapabilities(...)` helper.

### `src/errors.ts` — EXTEND (additive)
Keep all existing classes. ADD: `WorkdirNotARepoError`, `BinaryNotFoundError`, `MissingCredentialError`, `CapabilityMismatchError` (each `extends AdapterError`, with a remediation message). Do not change existing classes.

### `src/credentials/broker.ts` — structural broker (PRD §12)
`export interface CredentialBroker { getCredential(provider: string): Promise<{ apiKey: string; expiresAt?: Date }> }` — the lib's OWN structural copy so it has NO hard `@helmsmith/agent-auth` dependency. (agent-auth's `FileBroker`, widened to `string` in Phase 0, satisfies it structurally.)

### `src/registry.ts` — adapter registry (PRD §6, D5-adjacent)
`AdapterFactory = (spec, deps) => AgentAdapter`. `registerAdapter(type, factory, capabilities)` + `getAdapterFactory(type)` + the built-in registry (EMPTY in Phase A — adapters self-register in B–D′). The registry is also the source for `capabilities.ts`'s descriptors (or capabilities.ts owns the static matrix + the registry references it — pick one source of truth; the static matrix is fine as the canonical).

### `src/create-agent.ts` — the factory (PRD §6, §7.1, D3)
`createAgent(args: CreateAgentArgs): AgentAdapter` — (1) validate `workdir` via `git -C <workdir> rev-parse --is-inside-work-tree` → `WorkdirNotARepoError` on failure; (2) resolve `repoRoot`/`commit`/`branch` (best-effort, for metadata); (3) look up the factory by `spec.type` (throw a clear error if unregistered — adapters land in B–D′); (4) `CapabilityMismatchError` if the spec asks for a capability the type lacks; (5) construct + return. Synchronous-ish (the git check is async — `createAgent` returns `Promise<AgentAdapter>` OR does the git check eagerly; match the PRD — PRD shows sync return, so do the git validation synchronously via `execFileSync`/`spawnSync`).

### `src/adapters/shared/child-process.ts` — CLI lifecycle (PRD §9)
`spawnAgentProcess({ binary, args, cwd, env, signal, timeoutMs })` → a handle exposing stdout/stderr line streams + a `done` promise + abort (SIGTERM→2s→SIGKILL) + exit-code mapping. `resolveBinary(toolName, binaryPath?)` (→ `BinaryNotFoundError`). Used by C/D/D′; in Phase A it's the utility + its unit tests (mock `node:child_process.spawn` with the repo's `fakeChild()` pattern).

## Tests (colocated, vitest)
- `capabilities.test.ts`: `listAdapterTypes({supportsToolUse:true})` excludes `claude-sdk`(?? it's host-loop true — include) and `copilot-cli`; `{supportsStreaming:true}` excludes `copilot-cli`; empty filter → all.
- `stream.test.ts`: `reduceStream` over a fixed chunk sequence → the right `content`/`usage`/`finishReason`; the push-queue backpressure drop.
- `create-agent.test.ts`: non-git `workdir` → `WorkdirNotARepoError`; a git `workdir` (use the repo root or a tmp `git init`) → passes validation; unregistered `spec.type` → clear throw; register a fake factory → `createAgent` returns it.
- `child-process.test.ts`: spawn a fake child (mock), assert stdout lines stream + abort sends SIGTERM + exit-code→error mapping.
- `registry.test.ts`: register + retrieve + duplicate handling.

## Verify
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → still 0 (coexistence — old lib + consumers untouched).
- `pnpm test` → new Phase-A tests pass; ALL existing agent-adapter tests still green (nothing old changed).
- `biome check` on the new files → clean.
- Commit `core/agent-adapter-lib` on the branch (Co-Authored-By trailer). NEVER `git add -A`.
