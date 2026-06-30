# Phase D⁗ — gemini-sdk + openai-sdk adapters (chat-mode SDK)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A + the claude-sdk/copilot-sdk pattern (these are HTTP/SDK chat adapters — NO subprocess; mockable via the SDK client / `fetchFn`). **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated. **Sequencing:** after D‴ (same package). Build as two tasks or one (they're simpler than CLI adapters).

## COEXISTENCE + new types
New files under `src/adapters/gemini-sdk/` + `src/adapters/openai-sdk/`. ADDITIVELY add `'gemini-sdk'` + `'openai-sdk'` to `AgentSpecType` + `AgentSpec` variants + `CAPABILITY_MATRIX` rows (agent.ts/capabilities.ts). Do NOT touch `index.ts`, old flat adapters, old types/events. Self-register into the NEW `src/registry.ts`. Mirror `claude-sdk` (chat): `invoke`=`reduceStream(stream)`, broker auth + `MissingCredentialError`, AbortSignal, caps from matrix, API-level (host-loop) tool-use surfaced as `tool-call-*`.

## Deps
Add `@google/genai` (^2.10.0) + `openai` (^6.45.0) as **peerDependency(optional) + devDependency**. (Note: `@anthropic-ai/sdk` already present.)

## gemini-sdk (provider: google) — `@google/genai`
`src/adapters/gemini-sdk/{index.ts, normalize.ts}`:
- READ the real `@google/genai` API (`require.resolve` → `.d.ts`): confirm the client construction (`new GoogleGenAI({apiKey})`), the generate-content / streaming method, function-calling (tools) shape, and the stream event shape.
- `stream()` over the SDK's streaming method → map chunks → `AgentChunk` (text → text-delta, function-call → tool-call-*, usage metadata → usage, finish → message-stop). `invoke`=`reduceStream(stream)`.
- Auth: `broker.getCredential('google')` → apiKey (fallback `GEMINI_API_KEY`/`GOOGLE_API_KEY`); `MissingCredentialError`. `normalize.ts`: AgentInput.messages → Gemini `contents`; tools → Gemini function declarations.
- Caps from `CAPABILITY_MATRIX['gemini-sdk']` (chat: toolUse host-loop, streaming, usage; **supportsJsonMode:true** — Gemini structured output; sessionResume false). AbortSignal aborts the request. Register.

## openai-sdk (provider: openai) — `openai`
`src/adapters/openai-sdk/{index.ts, normalize.ts}`:
- READ the real `openai` API: client (`new OpenAI({apiKey})`), Chat Completions streaming (`client.chat.completions.create({stream:true})`) — or the Responses API; pick the one with the cleanest tool + stream story (Chat Completions is the safe default). Confirm the stream chunk shape (`choices[0].delta.content`, `tool_calls` deltas, `usage`).
- `stream()` → map → `AgentChunk` (delta.content → text-delta, tool_calls deltas → tool-call-*, usage → usage, finish_reason → message-stop). `invoke`=`reduceStream(stream)`.
- Auth: `broker.getCredential('openai')` → apiKey (fallback `OPENAI_API_KEY`); `MissingCredentialError`. `normalize.ts`: AgentInput → OpenAI messages + tools (function calling).
- Caps from `CAPABILITY_MATRIX['openai-sdk']` (chat: toolUse host-loop, streaming, usage; **supportsJsonMode:true** — `response_format`; sessionResume false). AbortSignal aborts. Register.

## Tests (each, colocated — mock the SDK)
- `index.test.ts`: `vi.mock('@google/genai')` / `vi.mock('openai')` with a fake streaming response (text + function-call + usage) → assert the AgentChunk mapping, reduceStream values, broker apiKey, missing-cred → MissingCredentialError, tool-call surfacing, abort. `normalize.test.ts`: AgentInput↔provider request/response shape. Conformance scenarios (echo, multi-turn, abort, usage, tool-use). LIVE test gated on the provider key (skip when absent).

## Verify (each)
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` → new tests pass; all prior green. Counts. `biome check` clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By trailer). NEVER `git add -A`.

## Self-review
Each: additive AgentSpecType/matrix; chat-mode (claude-sdk pattern); invoke=reduceStream; broker auth + MissingCredentialError; API-level tool-use host-loop; supportsJsonMode:true; AbortSignal; mockable SDK; coexistence honored; root typecheck still 0. Read the REAL SDK API before mapping.
