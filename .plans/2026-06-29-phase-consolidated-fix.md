# Consolidated Fix — all per-task review items (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Prereq:** all 11 adapters committed (incl. bedrock-sdk). **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated. **COEXISTENCE still holds** — additive/internal changes only; do NOT touch `index.ts` or the old flat adapters (those go in Phase F). Two SEQUENTIAL passes (same package). After this: Phase E (conformance).

## Pass A — capability model + matrix + structural (do first; later phases depend on the final caps)
1. **`toolUseMode` capability** (`capabilities.ts` + `agent.ts`): add `toolUseMode: 'autonomous' | 'host-loop' | 'none'` to `AdapterCapabilities`. Populate all 11: **autonomous** = claude-agent-sdk, claude-code-cli, opencode-cli, copilot-cli, gemini-cli, codex-cli; **host-loop** = claude-sdk, openai-sdk, gemini-sdk, copilot-sdk, bedrock-sdk; **none** = (none). Keep `supportsToolUse` as a derived convenience (`toolUseMode !== 'none'`). `listAdapterTypes` already filters on `Partial<AdapterCapabilities>` — add a test: `{toolUseMode:'autonomous'}` → exactly the 6 autonomous.
2. **Matrix TBD flips:** `opencode-cli` `reportsUsage:true` + `supportsExtendedThinking:true` (verified real); confirm gemini-cli/codex-cli rows (codex extThinking true, gemini false — already set). Update `capabilities.test.ts` accordingly.
3. **`tool-result` ContentBlock + tool message role** (`agent.ts`): add a `{ type:'tool-result'; toolCallId; output }` variant to `ContentBlock` AND allow a tool/`tool_result` message in `ChatMessage` (role `'tool'` or a tool-result content block) so a host can feed tool OUTPUTS back through `AgentInput` (host-loop tool use is currently one-way). Thread it through `normalize` in the host-loop SDK adapters (claude-sdk, openai-sdk, gemini-sdk, copilot-sdk, bedrock-sdk) so a tool-result message serializes to each provider's tool-result shape. Test each.
4. **copilot-cli → standalone `copilot`:** rework `adapters/copilot-cli/` to spawn the standalone `copilot -p <prompt> --allow-all-tools --add-dir <workdir>` (re-verify the real standalone output format — it may differ from the gh-launched build; capture a fixture) instead of `gh copilot -- -p …`. Update flags/index/stream-parser/tests. Caps become autonomous: `supportsToolUse:true`, `toolUseMode:'autonomous'`, `supportsStreaming` per reality. Remove the dead `CopilotCliSpec.subcommand` (`'shell'|'git'|'gh'`).
5. **Remove `copilot-agent-cli`:** delete it from `AgentSpecType` + `CAPABILITY_MATRIX` + the `ALL_TYPES` fixture (it was never built; redundant with the standalone copilot-cli).
6. **`mapFinishReason` default:** in gemini-sdk + openai-sdk (+ check others) change `default: 'stop'` → `'error'` (or `undefined`) so an unknown/future finish reason isn't masked as a clean stop.
Verify Pass A: package + root typecheck 0, biome clean, `pnpm test` green; commit.

## Pass B — per-adapter code/test fixes (after Pass A)
7. **B1 claude-sdk thinking mapping:** add `thinking` content_block_start + `thinking_delta` cases → `thinking-delta` chunks (it currently drops thinking despite `supportsExtendedThinking:true`). Test.
8. **Shared CLI custom-tools reject:** a shared helper — if `input.tools` is non-empty for a CLI adapter (claude-code-cli, opencode-cli, copilot-cli, gemini-cli, codex-cli; these have built-in autonomous tools, can't inject custom), throw `CapabilityMismatchError` (don't silently drop). Apply to all 5 CLI adapters + a test each.
9. **Credential precedence:** align the factory fast-path (`spec.apiKey ?? env`, skips broker) with `resolveApiKey` (spec→broker→env) — prefer the broker over env for rotation. Apply across claude-sdk + claude-code-cli (+ any with the dual path). Test the broker-before-env order.
10. **opencode reasoning tokens:** fold `tokens.reasoning` into `outputTokens` (currently dropped → under-reports). Test.
11. **codex reconnect-error non-terminal:** in `codex-cli/stream-parser.ts`, treat standalone `{type:'error',"Reconnecting…"}` events as logged/non-terminal (like gemini's warning skip); only `turn.failed` is terminal. Test with a reconnect-then-success transcript.
12. **gemini-sdk toolChoice:** map `input.toolChoice` → Gemini `toolConfig.functionCallingConfig` (openai already honors `tool_choice`). Test.
13. **De-vacu / add missing tests:** the B max_tokens guard (assert `streamMock` called with `max_tokens:8192`); the B2 claude-agent-sdk env-spread (`expect(lastQueryOptions.env).toMatchObject({ANTHROPIC_API_KEY}) + PATH survives`); broker-auth path tests (claude-sdk + claude-agent-sdk); B2 capability-mismatch test; lazy-MissingCredentialError (broker-returns-empty) test; broker-error logging in resolveApiKey `catch`.
14. **B2 missing-package error class:** claude-agent-sdk dynamic-import failure → `ConfigError`/`BinaryNotFoundError`, not `MissingCredentialError`.
Verify Pass B: package + root typecheck 0, biome clean, `pnpm test` green (full suite); commit.

## Verify (both passes)
- `pnpm --filter @helmsmith/agent-adapter typecheck` 0; root `pnpm typecheck` 0 (coexistence intact). `pnpm test` all green. `biome check` clean.
- listAdapterTypes({toolUseMode:'autonomous'}) returns the 6; host-loop tool-results round-trip; the 5 CLI adapters reject custom tools; copilot-cli is the standalone; copilot-agent-cli gone.
- Commit `core/agent-adapter-lib` (+ this plan) on the branch (Co-Authored-By trailer). NEVER `git add -A`.

## Self-review
toolUseMode added + matrix final + tool-result ContentBlock; copilot-cli=standalone, copilot-agent-cli removed; B1 thinking + shared CLI tools-reject + credential precedence + reasoning tokens + codex reconnect + gemini toolChoice + all de-vacu tests; coexistence held; whole suite green. Roster final at 11. → Phase E.
