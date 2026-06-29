# Phase B — Claude SDK adapters: chat + agent (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A (the new `src/agent.ts` types, `src/stream.ts` `AgentChunk`/`reduceStream`, `src/capabilities.ts` `CAPABILITY_MATRIX`, `src/registry.ts`, `src/create-agent.ts`). **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated.

## COEXISTENCE (continues from Phase A)
New files only, under `src/adapters/claude-sdk/` and `src/adapters/claude-agent-sdk/`. Do NOT touch `index.ts`, the OLD `claude-sdk-adapter.ts` (flat file — stays until Phase F), or the old types. The new adapters implement the NEW `AgentAdapter` (from `src/agent.ts`) and self-register into the NEW `src/registry.ts`. They are reachable only through `createAgent` (the new factory), not `index.ts`, until Phase F.

## Deps
Add `@anthropic-ai/sdk` (already a dep) — keep. Add `@anthropic-ai/claude-agent-sdk` (v0.3.195) as a **peerDependency (optional)** + devDependency (so tests/install resolve it). Both peer-optional per PRD §5/§8.1.

## B1 — `claude-sdk` (chat; PRD §8.1)
`src/adapters/claude-sdk/index.ts` `ClaudeSdkAdapter implements AgentAdapter` (the new interface) + `src/adapters/claude-sdk/normalize.ts` (request/response shape mapping).
- `invoke(input: AgentInput, opts?): Promise<AgentInvocationResult>` and `stream(input, opts?): AsyncIterable<AgentChunk>`; `invoke` = `reduceStream(stream(...))` (parity).
- `stream`: `client.messages.stream({ model: spec.model, system: input.systemPrompt ?? spec.systemPrompt, messages: normalize(input.messages), max_tokens: spec.maxTokens ?? <sane default, NOT 256>, tools: input.tools?, ... })` → re-emit SDK stream events as `AgentChunk` (text deltas → `text-delta`, tool_use blocks → `tool-call-start/input/end`, message_stop → `message-stop` with finishReason, usage → `usage`). Map SDK errors via `classifyHttpError`/`classifyNetworkError`.
- Tool use: API-level (host runs the loop — NOT autonomous); surface `tool-call-*` chunks; host re-invokes with tool_result messages.
- Auth: `broker.getCredential('anthropic')` → `apiKey` on the SDK client; fall back to `ANTHROPIC_API_KEY`. `MissingCredentialError` if neither (at construct, per D7-style fail-fast).
- `workdir`: validated by `createAgent`; captured as metadata (no cwd use — in-process).
- `capabilities`: from `CAPABILITY_MATRIX['claude-sdk']` (toolUse:true host-loop, streaming, usage, thinking; jsonMode:false; sessionResume:false).
- `AbortSignal`: abort the SDK stream → `finishReason: 'aborted'`.
- Register: `registerAdapter('claude-sdk', factory, CAPABILITY_MATRIX['claude-sdk'])`.

## B2 — `claude-agent-sdk` (agent; the in-process autonomous runtime)
`src/adapters/claude-agent-sdk/index.ts` `ClaudeAgentSdkAdapter implements AgentAdapter`.
- **First read the real API:** `node -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk'))"` then read its `.d.ts` — confirm the `query({ prompt, options })` signature, the message/event stream shape, how tools + `cwd` + the system prompt + the API key are passed, and how to abort. (It is the programmatic Claude Code: an autonomous agentic loop with built-in file/shell tools.)
- `stream`: call `query()` with `prompt` = the input's last user message (+ prior messages as context), `options` carrying `cwd: workdir`, the system prompt (`input.systemPrompt ?? spec.systemPrompt`), model, and `ANTHROPIC_API_KEY` (from the broker, via env or option per the SDK). Map the query's message stream → `AgentChunk`: assistant text → `text-delta`, the SDK's tool-use messages → `tool-call-start/end` (observability — autonomous, host can't inject tools), thinking → `thinking-delta`, final result → `message-stop` + `usage`.
- `invoke` = `reduceStream(stream(...))`.
- Auth: broker `anthropic` cred → `ANTHROPIC_API_KEY`; `MissingCredentialError` if absent (construct-time).
- `workdir` → the query `cwd` (the agent's tools operate there). `capabilities`: `CAPABILITY_MATRIX['claude-agent-sdk']` (autonomous toolUse, streaming, usage, thinking, cancellation).
- `AbortSignal` → abort the query.
- Register: `registerAdapter('claude-agent-sdk', factory, CAPABILITY_MATRIX['claude-agent-sdk'])`.

## Tests (colocated, mock the SDKs)
- `claude-sdk/index.test.ts`: `vi.mock('@anthropic-ai/sdk')` → a fake stream emitting text + tool_use + usage events; assert `stream` yields the right `AgentChunk`s, `invoke` reduces to the right `content`/`usage`/`finishReason`, the broker supplies the apiKey, missing cred → `MissingCredentialError`, abort → `finishReason:'aborted'`, NO `max_tokens:256` hardcode. The conformance scenarios (echo, multi-turn, abort, usage).
- `claude-agent-sdk/index.test.ts`: `vi.mock('@anthropic-ai/claude-agent-sdk')` → a fake `query()` async iterable emitting assistant text + a tool-use message + a result; assert the `AgentChunk` mapping, `cwd`=workdir is passed, tool-use surfaces as `tool-call-*`, the tool-use conformance scenario, abort.
- A LIVE integration test for each, gated on a real `ANTHROPIC_API_KEY` (skipped in CI / when absent) — manual smoke.
- Run the Phase E conformance suite shape if it exists yet; otherwise inline the scenarios.

## Verify (report all)
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` → new adapter tests pass; existing + Phase-A tests still green.
- `biome check` on the new files → clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By trailer). NEVER `git add -A`.

## Self-review
Both adapters implement the NEW `AgentAdapter`; `invoke` = reduceStream(stream) (parity); auth via broker + MissingCredentialError; B1 host-loop tools, B2 autonomous; caps from the matrix; coexistence honored (index.ts/old files untouched); root typecheck still 0.
