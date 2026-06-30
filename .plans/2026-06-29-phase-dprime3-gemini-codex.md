# Phase D‴ — gemini-cli + codex-cli adapters

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A + the claude-code-cli/opencode-cli/copilot-agent-cli pattern. **Both binaries installed.** **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated. **Sequencing:** after D″ (same package). Build as TWO tasks (gemini first, then codex) — each its own verified adapter; or one implementer doing both sequentially.

## COEXISTENCE + new types
New files under `src/adapters/gemini-cli/` and `src/adapters/codex-cli/`. ADDITIVELY add `'gemini-cli'` + `'codex-cli'` to `AgentSpecType` (agent.ts) + their `AgentSpec` variants + rows to `CAPABILITY_MATRIX` (capabilities.ts) — additive only. Do NOT touch `index.ts`, old flat adapters, old types/events. Self-register into the NEW `src/registry.ts`. Mirror the claude-code-cli/opencode-cli structure (index/flags/stream-parser + the shared `child-process.ts`, sandbox, broker auth, MissingCredentialError, invoke=reduceStream, exactly-one-terminal-chunk).

## gemini-cli (provider: google) — `gemini` v0.43.0
- **Verify real:** `gemini --help` + `gemini -p "say OK" -o stream-json --yolo` in a tmp git dir; capture the stream-json transcript. Gemini HAS structured output (`-o stream-json`) — map it to AgentChunk (like claude-code-cli's stream-json).
- Spawn `gemini -p <prompt> -o stream-json --approval-mode yolo` (non-interactive, auto-approve tools) via `shared/child-process.ts`, `cwd=workdir`. `--add-dir`/policy if needed.
- Sandbox `$HOME`/`$TMPDIR`→workdir. Auth: gemini uses Google auth (`~/.gemini`/API key / `GEMINI_API_KEY`) — inject from `broker.getCredential('google')` via the env var gemini reads (verify); MissingCredentialError. **Suppress MCP** (PRD no-MCP — `--allowed-mcp-server-names` empty or whatever disables it; verify).
- `stream-parser.ts`: real gemini stream-json events → AgentChunk (text/thinking/tool-call/usage/stop). Handle split lines.
- Caps from `CAPABILITY_MATRIX['gemini-cli']` (autonomous tools; verify usage/thinking/streaming vs reality, flag matrix needs). AbortSignal→'aborted'. Register.

## codex-cli (provider: openai) — `codex` v0.133.0
- **Verify real:** `codex --help` + `codex exec --help` + a real `codex exec "say OK" --sandbox <mode>` (non-interactive); determine the OUTPUT format (text? `--json`? a structured/experimental stream? check `codex exec --help` for output/json flags). Capture a transcript. If only text, synthesize chunks; if structured, parse to AgentChunk.
- Spawn `codex exec <prompt>` (the non-interactive subcommand) via `shared/child-process.ts`, `cwd=workdir`, with a sandbox/approval mode that runs tools non-interactively (`--sandbox <mode>` or `--dangerously-bypass-approvals-and-sandbox` — pick the safe non-interactive one + document). Sandbox `$HOME`/`$TMPDIR`.
- Auth: codex uses OpenAI auth (`~/.codex`/`OPENAI_API_KEY`) — inject from `broker.getCredential('openai')`; MissingCredentialError. Suppress MCP if codex loads any.
- `stream-parser.ts` (or synthetic chunks if text-only): real codex exec output → AgentChunk. Caps from `CAPABILITY_MATRIX['codex-cli']` (verify vs reality, flag). AbortSignal→'aborted'. Register.

## Tests (each, colocated)
- `stream-parser.test.ts`: captured real transcript + edge cases → AgentChunk sequence.
- `index.test.ts`: mock spawn → flags + cwd + sandbox env + auth injection + MCP suppression; missing cred → MissingCredentialError; abort → 'aborted'; invoke=reduceStream parity. `flags.test.ts`.
- LIVE integration test — RUNNABLE (binaries installed); gate on the provider key/auth (skip if absent), try a real round-trip.

## Verify (per adapter)
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` → new tests pass; all prior green. Counts.
- `biome check` new files → clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By trailer). NEVER `git add -A`.

## Self-review
Each: additive AgentSpecType/matrix entry; spawns via shared/child-process verified-real; sandboxed + provider-broker auth + MissingCredentialError + MCP suppressed; stream-parser/synthetic against REAL output; invoke=reduceStream; caps verified vs the installed version (flag matrix deltas); coexistence honored; root typecheck still 0. Follow the REAL CLI over any assumption.
