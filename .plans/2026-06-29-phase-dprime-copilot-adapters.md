# Phase D′ — Copilot adapters (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A scaffold + Phase 0 (the broker now exchanges `github-copilot` → Copilot session token). **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated.

## Scope decision (read this)
Build the TWO verifiable copilot adapters: **copilot-sdk** (HTTP — testable via fetch mock + the real broker) and **copilot-cli** (`gh copilot` v1.2.0 is installed — verifiable; the PRD's "limited reference adapter" for the conformance skip-path). **DEFER `copilot-agent-cli`** (the agentic standalone `copilot` CLI): the binary is NOT installed, so its real headless format can't be verified — building it blind would be guesswork (the PRD's assumed flags have been WRONG for both claude and opencode). Leave `copilot-agent-cli` in the `AgentSpecType`/matrix but DO NOT register an adapter; note it as deferred-pending-binary.

## COEXISTENCE
New files ONLY under `src/adapters/copilot-sdk/` + `src/adapters/copilot-cli/`. Do NOT touch `index.ts`, old flat adapters (incl. the old `copilot-chat-adapter.ts` — stays until Phase F), old types/events. Self-register into the NEW `src/registry.ts`. (May extend `agent.ts`/`capabilities.ts` ADDITIVELY only if a spec field is missing — flag it.)

## Reference
PRD §8.4 (copilot-sdk), §8.5 (copilot-cli), §11 (tools), §12 (auth). The OLD `src/copilot-chat-adapter.ts` (read it — but its token-exchange now lives in the broker via Phase 0; the new copilot-sdk uses `broker.getCredential('github-copilot')` which returns the EXCHANGED Copilot session token). Mirror the Phase B/C/D adapter structure.

## copilot-sdk (HTTP, OpenAI-compatible — PRD §8.4)
`src/adapters/copilot-sdk/{index.ts, normalize.ts, headers.ts, sse-parser.ts}`:
- `CopilotSdkAdapter implements AgentAdapter`. `invoke` = single POST to `https://api.githubcopilot.com/chat/completions`, parse → `AgentInvocationResult`. `stream` = POST `stream:true`, `sse-parser.ts` consumes `data: {...}\n\n` → `AgentChunk` (`choices[0].delta.content` → text-delta, `tool_calls` deltas → tool-call-*, final usage). `invoke`=`reduceStream(stream)`.
- **Auth:** `broker.getCredential('github-copilot')` → `{apiKey: <copilot session token>}` (the broker exchanges it — Phase 0); `Authorization: Bearer <token>`. `MissingCredentialError` if absent. Fallback `COPILOT_TOKEN` env (discouraged).
- `headers.ts`: the hardcoded Copilot contract headers per PRD §8.4 (`User-Agent: GithubCopilot/1.155.0`, `Editor-Version`, `Editor-Plugin-Version: copilot.vim/1.16.0`, `Copilot-Integration-Id: vscode-chat`, `Openai-Intent: conversation-panel`). Log all at debug.
- `normalize.ts`: `AgentInput` → OpenAI request body; response → result. Custom tool-use (OpenAI function calling) forwarded + surfaced as tool-call-* (host-loop).
- `fetchFn` injection for tests. Caps from `CAPABILITY_MATRIX['copilot-sdk']`. AbortSignal aborts the fetch. Self-register.

## copilot-cli (gh copilot — LIMITED — PRD §8.5)
`src/adapters/copilot-cli/{index.ts, flags.ts}`:
- **First verify real `gh copilot` v1.2.0:** `gh copilot suggest --help` + a real `gh copilot suggest -t shell "<prompt>"` — capture the real output shape.
- `CopilotCliAdapter implements AgentAdapter` (LIMITED): spawns `gh copilot suggest --target=shell|git|gh <prompt>` (per `spec.subcommand`) via `shared/child-process.ts`; single-turn, non-streaming → wrap the suggestion in ONE synthetic `text-delta` + `message-stop` (so the streaming contract holds). Sandbox `$HOME`/`$TMPDIR`→workdir.
- **Auth (note the gap):** `gh` needs `GH_TOKEN` (the GitHub OAuth token), NOT the exchanged Copilot session token. The broker's `github-copilot` provider's RAW apiKey IS the github token, but the broker now returns the exchanged token. So: read `GH_TOKEN` from env/`spec.env` if present; else document that copilot-cli needs the github token surfaced separately (a Phase-0-adjacent gap — FLAG it, don't block). Validate + `MissingCredentialError` if no usable token.
- Caps `CAPABILITY_MATRIX['copilot-cli']` (`supportsToolUse:false`, `supportsStreaming:false`). Self-register. This is the conformance "limited adapter" (Phase E skips tool-use/multi-turn/streaming scenarios for it).

## Tests (colocated)
- `copilot-sdk/*.test.ts`: `fetchFn` stub → assert the request URL/headers/body (normalize), the SSE→AgentChunk mapping (sse-parser), broker token used as Bearer, missing cred → MissingCredentialError, tool_calls → tool-call-*, abort. The headers match §8.4.
- `copilot-cli/*.test.ts`: mock spawn → assert `gh copilot suggest` argv + target + sandbox env; the single synthetic text-delta+message-stop; a custom `tools` array → (the eventual shared CLI behavior — for now mirror claude-code-cli/opencode-cli; the consolidated fix adds the shared reject); no streaming. A live test gated on `gh copilot` + auth (skip when absent).

## Verify
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` → new tests pass; Phase A/B/C/D + existing green. Counts.
- `biome check` new files → clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>). NEVER `git add -A`. (A read-only Phase-D review runs concurrently — no conflict.)

## Self-review
copilot-sdk: HTTP, broker exchanged-token Bearer, §8.4 headers, normalize + sse-parser, custom tools host-loop, invoke=reduceStream. copilot-cli: gh copilot suggest verified real, single synthetic chunk, limited caps, auth-gap flagged. agentic copilot-agent-cli DEFERRED (binary absent). Coexistence honored; root typecheck still 0. Follow the REAL `gh copilot` over PRD assumptions.
