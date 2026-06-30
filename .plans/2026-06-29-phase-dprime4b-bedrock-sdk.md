# Phase D⁗b — bedrock-sdk adapter (AWS Bedrock Converse)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A + the chat-SDK pattern (claude-sdk/copilot-sdk/openai-sdk). **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated, `vi.mock`. **Sequencing:** after D⁗ (same package).

## COEXISTENCE + new type
New files ONLY under `src/adapters/bedrock-sdk/`. ADDITIVELY add `'bedrock-sdk'` to `AgentSpecType` + a `BedrockSdkSpec` variant (`model` + `region` + optional `profile`) + a `CAPABILITY_MATRIX['bedrock-sdk']` row. Do NOT touch `index.ts`, old flat adapters, old types/events. Self-register into the NEW `src/registry.ts`. Touch ONLY `core/agent-adapter-lib/` (+ package.json for the dep). NOTE: `'bedrock'` is already a `Provider` in agent-auth (currently reserved/throws) — this fills it.

## Build — `@aws-sdk/client-bedrock-runtime` (Converse/ConverseStream)
`src/adapters/bedrock-sdk/{index.ts, normalize.ts}`:
- READ the real `@aws-sdk/client-bedrock-runtime` API (`require.resolve` → `.d.ts`): `BedrockRuntimeClient`, `ConverseCommand`, `ConverseStreamCommand`, the request shape (`modelId`, `messages`, `system`, `inferenceConfig`, `toolConfig`), and the stream event union (`messageStart`/`contentBlockStart`/`contentBlockDelta`/`contentBlockStop`/`messageStop`/`metadata`).
- `BedrockSdkAdapter implements AgentAdapter` (chat, host-loop): `new BedrockRuntimeClient({ region, credentials })`; `stream()` over `ConverseStreamCommand` → map events → `AgentChunk` (`contentBlockDelta.delta.text` → text-delta, `delta.toolUse` → tool-call-*, `delta.reasoningContent` → thinking-delta, `metadata.usage` → usage, `messageStop` → message-stop with stopReason). `invoke`=`reduceStream(stream)`.
- `normalize.ts`: `AgentInput.messages` → Converse `messages` (role + content blocks); `systemPrompt` → `system`; `tools` → `toolConfig.tools` (Bedrock tool spec); response toolUse blocks → tool-call-* (host-loop).
- **AUTH (the wrinkle — DOCUMENT it):** Bedrock uses the AWS credential chain, NOT a `{apiKey}`. Resolve via the AWS SDK's **default credential provider chain** (env `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`/`AWS_REGION`, `~/.aws/credentials`, SSO, IAM role) — i.e. construct the client WITHOUT explicit creds and let the SDK resolve, OR accept `spec.region`/`spec.profile`. The `CredentialBroker` is bypassed for bedrock (or, optionally, if `broker.getCredential('bedrock')` returns something usable, map it — but default to the AWS chain). At construct, do a cheap check that creds resolve (or defer to first call); throw `MissingCredentialError` with an AWS-specific remediation if not. `region` is REQUIRED (from spec or `AWS_REGION`) — `ConfigError` if absent.
- AbortSignal → pass an `abortSignal` to the command / abort the request → `finishReason:'aborted'`. Caps from `CAPABILITY_MATRIX['bedrock-sdk']`: host-loop tools (`toolUseMode:'host-loop'`), streaming (ConverseStream), `reportsUsage:true` (metadata.usage), `supportsExtendedThinking` (Converse reasoningContent — verify, set accordingly), `supportsJsonMode:false` (Converse uses tool-use for structure). Register.

## Deps
Add `@aws-sdk/client-bedrock-runtime` (^3.1076.0) as peerDependency(optional) + devDependency. `pnpm install`.

## Tests (colocated — mock the AWS client)
- `index.test.ts`: `vi.mock('@aws-sdk/client-bedrock-runtime')` — fake `ConverseStreamCommand` send() returning an async-iterable `stream` of the event union (messageStart → contentBlockDelta text + toolUse → metadata usage → messageStop) → assert AgentChunk mapping, reduceStream values, region passed, missing-region → ConfigError, no-creds → MissingCredentialError, tool-call surfacing, abort. `normalize.test.ts`: AgentInput↔Converse shapes (messages/system/toolConfig). LIVE test gated on AWS creds + a region (skip when absent — likely skipped in this env).

## Verify
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence). `pnpm test` → new tests pass; all prior green. Counts. `biome check` clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>). NEVER `git add -A`.

## Self-review
Additive type/matrix; chat-mode Converse/ConverseStream against the REAL SDK; invoke=reduceStream; AWS-credential-chain auth (broker bypassed, documented) + region required + MissingCredentialError/ConfigError; host-loop tools via toolConfig; toolUseMode:'host-loop'; AbortSignal; mockable; coexistence honored; root typecheck still 0. This is adapter 11/11 — after it: consolidated fix → E → F → G.
