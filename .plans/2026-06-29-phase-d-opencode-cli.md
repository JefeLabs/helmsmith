# Phase D — opencode-cli adapter (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** Phase A (`agent.ts`, `stream.ts`, `capabilities.ts`, `registry.ts`, `errors.ts`, `adapters/shared/child-process.ts`) + the Phase C `claude-code-cli` pattern (mirror its structure). **The `opencode` CLI is installed** (v1.17.5) — verify real flags/output against it. **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated.

## COEXISTENCE
New files ONLY under `src/adapters/opencode-cli/`. Do NOT touch `index.ts`, the OLD flat `opencode-cli-adapter.ts` (stays until Phase F), or old types/events. Self-register into the NEW `src/registry.ts`. The old flat `OpenCodeCliAdapter` keeps working for current consumers; this is the NEW-shape replacement.

## Reference
PRD §8.3 (opencode-cli), §9 (CLI lifecycle), §10 (streaming). The OLD `src/opencode-cli-adapter.ts` (read it — PORT its strengths: local-endpoint mode, XDG config-dir isolation, `--attach`/serverUrl, provider env-var injection). Mirror the Phase C `claude-code-cli` adapter structure (index/flags/stream-parser).

## Build
`src/adapters/opencode-cli/{index.ts, flags.ts, stream-parser.ts}`:
- **First verify the REAL CLI:** run `opencode --help` + a real `opencode run --print` (or the correct v1.17.5 flags for headless + JSON/stream output) with a tiny prompt; capture a representative stdout transcript as a fixture. The PRD §8.3 says the opencode flag set is younger/less stable than claude — follow the REAL CLI.
- `OpenCodeCliAdapter implements AgentAdapter` (the NEW interface): `stream()` spawns `opencode` via `shared/child-process.ts` with `cwd=workdir`; parse stdout (stream-json or opencode's JSON format — whatever's real) → `stream-parser.ts` → `AgentChunk`; `invoke`=`reduceStream(stream)`.
- **Sandbox:** `$HOME`/`$TMPDIR` → `workdir`; inject the provider credential via env from `broker.getCredential(<provider>)` (verify the env var opencode reads); validate at construct → `MissingCredentialError`.
- **PORT from the old adapter:** local-endpoint mode (`endpoint`/`endpointProviderId`/`staticApiKey`), XDG/config-dir isolation (the temp `opencode.json` to suppress MCP + register the model), `--attach`/`serverUrl` mode, provider env injection. Keep these as options on the new adapter.
- `flags.ts`: AgentSpec → opencode flags. `stream-parser.ts`: real opencode output → AgentChunk (handle split lines).
- AbortSignal → SIGTERM→SIGKILL → `finishReason:'aborted'`. Caps from `CAPABILITY_MATRIX['opencode-cli']` — **VERIFY the §8.7 TBDs** (`reportsUsage`, `supportsExtendedThinking`) against opencode v1.17.5's actual output; if they differ from the matrix, note it (matrix fix is a Phase-A-file touch — flag it, don't silently diverge). `registerAdapter('opencode-cli', ...)`.

## Tests (colocated)
- `stream-parser.test.ts`: the captured real transcript + edge cases → assert the AgentChunk sequence.
- `index.test.ts`: mock spawn → flags + `cwd=workdir` + sandbox env + provider cred injection; the local-endpoint + `--attach` modes; missing cred → MissingCredentialError; abort → 'aborted'; invoke=reduceStream parity. `flags.test.ts`.
- A LIVE integration test gated on the `opencode` binary + creds (skip when absent).

## Verify
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` (or scoped) → new tests pass; Phase A/B/C + existing green. Counts.
- `biome check` new files → clean.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>). NEVER `git add -A`.

## Self-review
New AgentAdapter; spawns via shared/child-process; sandboxed + provider env injection + MissingCredentialError; PORTS the old adapter's strengths (local-endpoint/XDG/attach); stream-parser against the REAL opencode output; invoke=reduceStream; caps verified vs v1.17.5; coexistence honored; root typecheck still 0. Follow the REAL `opencode` CLI over the PRD's assumed flags.
