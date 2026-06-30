# Phase D″ — copilot-agent-cli adapter (the agentic GitHub Copilot CLI)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A scaffold + the claude-code-cli/opencode-cli pattern. **Was deferred** (binary absent) — now `@github/copilot` 1.0.65 (`copilot` at `/opt/homebrew/bin/copilot`) is installed, so build it. **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated. **Sequencing:** dispatch AFTER Phase D′ commits (same package).

## COEXISTENCE
New files ONLY under `src/adapters/copilot-agent-cli/`. Do NOT touch `index.ts`, old flat adapters, old types/events. Self-register into the NEW `src/registry.ts`. `copilot-agent-cli` already exists in `AgentSpecType` + `CAPABILITY_MATRIX` (Phase A) — register the adapter for it now.

## CRITICAL — verify the REAL `copilot` CLI (1.0.65 installed)
Before coding: `copilot --help` (full), and a real headless run `copilot -p "say OK" --allow-all-tools --add-dir <tmp>` (in a tmp git dir). Determine:
- The exact non-interactive flags (`-p/--prompt`, `--allow-all-tools`/`--allow-all-paths`/`--allow-all-urls` or `--allow-all`, `--add-dir`).
- The OUTPUT format: is there a structured/JSON/stream output flag, or is it plain text? Build the parser against what's REAL. If only plain text, wrap the final result in synthetic `text-delta` + `message-stop` (+ surface tool activity if any structured logging exists); if structured/stream output exists, map it to `AgentChunk` properly.
- **MCP:** the CLI reads `~/.copilot/mcp-config.json` + `--additional-mcp-config`. PRD = NO MCP. Suppress MCP (e.g. point config at an empty/temp file, or whatever disables it) like opencode's MCP suppression. Flag the exact mechanism.
- Capture a real transcript as a fixture.

## Build
`src/adapters/copilot-agent-cli/{index.ts, flags.ts, stream-parser.ts}`:
- `CopilotAgentCliAdapter implements AgentAdapter` (autonomous, like claude-code-cli/opencode): spawn `copilot -p <prompt> --allow-all-tools --add-dir <workdir>` (+ MCP suppression) via `shared/child-process.ts` with `cwd=workdir`; map output → `AgentChunk` (`stream-parser.ts` if structured; else synthetic chunks); `invoke`=`reduceStream(stream)`.
- **Sandbox** `$HOME`/`$TMPDIR`→workdir. **Auth:** the copilot CLI uses GitHub auth (`~/.copilot`/a token) — sandboxed → inject the github token via env (same `GH_TOKEN`/COPILOT auth-gap as copilot-cli — read from env/spec.env, FLAG the broker gap; `MissingCredentialError` if no usable token). Verify which env var `copilot` honors for non-interactive auth.
- AbortSignal→SIGTERM→SIGKILL→`finishReason:'aborted'`. Caps from `CAPABILITY_MATRIX['copilot-agent-cli']` (autonomous toolUse:true) — VERIFY vs reality (does it report usage? stream? thinking?) and FLAG any matrix change needed (don't silently diverge). For a custom `tools` array, MIRROR the other CLI adapters (the consolidated fix adds the shared reject). `registerAdapter('copilot-agent-cli', ...)`.

## Tests (colocated)
- `stream-parser.test.ts`: the captured real transcript + edge cases → AgentChunk sequence.
- `index.test.ts`: mock spawn → flags (`-p`/`--allow-all-tools`/`--add-dir`) + cwd + sandbox env + MCP suppression + auth injection; missing cred → MissingCredentialError; abort → 'aborted'; invoke=reduceStream parity. `flags.test.ts`.
- LIVE integration test — now RUNNABLE (binary installed); gate on auth (skip if `copilot` not authed in this env), but try a real `copilot -p` round-trip.

## Verify
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` → new tests pass; all prior green. Counts.
- `biome check` new files → clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>). NEVER `git add -A`.

## Self-review
Autonomous CLI adapter; spawns `copilot -p --allow-all-tools` verified-real; sandboxed + auth-injected + MissingCredentialError + MCP suppressed; stream-parser/synthetic chunks against REAL output; invoke=reduceStream; caps verified vs 1.0.65; coexistence honored; root typecheck still 0. Follow the REAL `copilot` CLI over any assumption.
