# Phase C — claude-code-cli adapter (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A (`src/agent.ts`, `src/stream.ts` AgentChunk, `src/capabilities.ts`, `src/registry.ts`, `src/errors.ts`, **`src/adapters/shared/child-process.ts`**). **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated. **The `claude` CLI is installed** (v2.1.195) — verify real flags/output against it.

## COEXISTENCE
New files ONLY under `src/adapters/claude-code-cli/`. Do NOT touch `index.ts`, old flat adapter files, or old types/events. Self-register into the NEW `src/registry.ts`. (May read/reuse `shared/child-process.ts`; only ADD to it if a needed primitive is missing — additively.)

## Reference
PRD §8.2 (claude-code-cli), §9 (CLI process lifecycle), §10 (streaming), §11 (tool use — CLI built-in tools are observability-only).

## Build
`src/adapters/claude-code-cli/{index.ts, flags.ts, stream-parser.ts}`:
- **First, verify the REAL CLI contract:** run `claude --help` and a real `claude --print --output-format stream-json --input-format stream-json` (or the correct flags for v2.1.195) with a tiny prompt to capture a sample stdout transcript. Confirm the exact flags + the stream-json event shapes. Save a representative transcript as a test fixture.
- `index.ts` `ClaudeCodeCliAdapter implements AgentAdapter` (the new interface): `stream()` spawns `claude` via `shared/child-process.ts` (`spawnAgentProcess`) with `cwd = workdir`; pipe `AgentInput` (messages) as stream-json over stdin (or the CLI's input format); read stdout stream-json → `stream-parser.ts` → `AgentChunk`s. `invoke` = `reduceStream(stream(...))`.
- **Sandbox (PRD §8.2):** spawn with `$HOME` and `$TMPDIR` redirected to the `workdir` (env override) so claude-code's own `~/.claude` state is isolated. Because the sandbox hides claude's own auth, **inject `ANTHROPIC_API_KEY` via env** from `broker.getCredential('anthropic')`; validate at construct → `MissingCredentialError` if absent (fail-fast, never mid-stream).
- `flags.ts`: `AgentSpec` → claude CLI flags (model, system prompt, output/input format, etc.).
- `stream-parser.ts`: a line-buffered state machine; each complete stream-json line → one or more `AgentChunk`s (assistant text → text-delta, tool_use → tool-call-start/input/end [built-in tools, observability], result → message-stop + usage, errors → error chunk).
- AbortSignal → SIGTERM→SIGKILL (via shared child-process) → `finishReason:'aborted'`.
- Caps from `CAPABILITY_MATRIX['claude-code-cli']` (autonomous tools, streaming, usage, thinking, cancellation; jsonMode false; sessionResume false). `registerAdapter('claude-code-cli', ...)`.

## Tests (colocated)
- `stream-parser.test.ts`: feed the captured real stream-json transcript (+ hand-crafted edge cases: split lines across chunks, a tool_use sequence, an error event, a final result with usage) → assert the AgentChunk sequence. This is the heart of the adapter — test it thoroughly.
- `index.test.ts`: mock `shared/child-process.ts`/`spawn` (the repo `fakeChild()` pattern) → assert the adapter spawns `claude` with the right flags + `cwd=workdir` + `$HOME`/`$TMPDIR`/`ANTHROPIC_API_KEY` env; missing cred → `MissingCredentialError`; abort → SIGTERM + `finishReason:'aborted'`; `invoke`=reduceStream parity. `flags.test.ts`: AgentSpec→flags.
- A LIVE integration test gated on the `claude` binary + a real `ANTHROPIC_API_KEY` (skipped when absent) — a real `claude -p` round-trip producing a text result.

## Verify
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` (or scoped) → new tests pass; Phase A/B + existing still green. Counts.
- `biome check` new files → clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>). NEVER `git add -A`.

## Self-review
Implements the new AgentAdapter; spawns via shared/child-process; sandboxed $HOME/$TMPDIR + env-injected ANTHROPIC_API_KEY + MissingCredentialError; stream-parser maps real stream-json → AgentChunk; invoke=reduceStream; built-in tools observability-only; caps from matrix; coexistence honored; root typecheck still 0. If the real `claude` flags/output differ materially from PRD §8.2's assumption, adapt to the REAL CLI + note it (don't force the PRD's assumed flags).
