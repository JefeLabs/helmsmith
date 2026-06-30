# Phase E — Conformance suite (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Package:** `core/agent-adapter-lib`. **Depends on:** ALL adapters (B claude-sdk/claude-agent-sdk, C claude-code-cli, D opencode-cli, D′ copilot-sdk/copilot-cli, D″ copilot-agent-cli) + the consolidated fix (so capabilities/custom-tools behavior is final). **Dispatch LAST in the adapter chain**, after the consolidated fix commits. **Conventions:** TS ESM, explicit `.ts` imports, Biome, vitest colocated. **Reference:** PRD §5 (the conformance suite is "the keystone"), §13 D5 (exported as `@helmsmith/agent-adapter/conformance`), §8.5 (the limited-adapter skip path).

## Goal
A single reusable suite that drives any `AgentAdapter` through a fixed scenario set. If a (built-in or third-party) adapter passes, it is swap-compatible by definition. Exported so adapter authors can run it.

## COEXISTENCE
New files ONLY under `src/conformance/`. Do NOT touch `index.ts` (the new surface is still internal until Phase F) — but ADD a `./conformance` export path in `package.json` `exports` (additive; the main `.` export stays the old surface until Phase F). Do NOT touch old files. The conformance test imports adapters via the NEW `registry`/`createAgent`, not `index.ts`.

## Build
`src/conformance/{index.ts, scenarios.ts, fixtures/index.ts}`:
- `scenarios.ts`: the scenario definitions — **echo** (single prompt → asserts text in result), **multi-turn** (two user turns → assistant responds in context), **abort mid-stream** (abort during stream → `finishReason:'aborted'`, no throw unless opted), **tool-use** (a tool-call surfaces in the stream), **malformed input** (empty messages / bad shape → a clear thrown `AdapterError`, not a crash). Each scenario is a `{ name, run(adapter, harness), skipFor?: (caps) => boolean }`.
- `index.ts`: `runConformance(makeAdapter: () => AgentAdapter, opts?: { skipScenarios?: string[] })` — drives the adapter through every scenario, returns/asserts results; honors per-adapter skips (the **limited-adapter path** — `copilot-cli` skips `tool-use`/`multi-turn`/`streaming-incremental` via a documented `skipScenarios`). Also a capability-aware auto-skip: a scenario whose `skipFor(caps)` is true is skipped (e.g. tool-use scenario skipped when `!supportsToolUse`).
- `fixtures/`: the canned backend responses (reuse the per-adapter fixtures captured in B–D″) so the suite runs **deterministically with mocked backends** (no network/CLI in CI). The suite injects the mock backend per adapter type (the `fetchFn` for HTTP adapters, the `fakeChild()`/mocked-SDK for CLI/SDK adapters).

## The driving test
`src/conformance.test.ts` (or `test/conformance.test.ts` if the repo prefers): imports the conformance runner + each built-in adapter factory, runs the full suite against all of them with mocked backends. `copilot-cli` runs the reduced subset (the limited-adapter reference). This is the swap-compatibility guarantee — every adapter passes the same scenarios.

## Verify
- `pnpm --filter @helmsmith/agent-adapter typecheck` → 0. Root `pnpm typecheck` → STILL 0 (coexistence).
- `pnpm test` → the conformance test passes for ALL adapters (limited subset for copilot-cli); all prior tests green. Counts.
- `biome check` new files → clean. The `./conformance` export resolves.
- Commit `core/agent-adapter-lib` (+ this plan doc) on the branch (Co-Authored-By trailer). NEVER `git add -A`.

## Self-review
The suite drives every adapter through echo/multi-turn/abort/tool-use/malformed with mocked backends; the limited-adapter skip path works for copilot-cli; capability-aware auto-skip; exported as `@helmsmith/agent-adapter/conformance`; coexistence honored (main `.` export untouched, `./conformance` added); root typecheck still 0. If an adapter FAILS a scenario, that's a real adapter bug — fix it (or, if it's a deliberate limitation, add it to that adapter's documented skip set with justification).
