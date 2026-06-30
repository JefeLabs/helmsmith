# Phase F — Consumer migration + LangGraph extrication + deps bump (detailed plan)

**Branch:** `agent-adapter-prd-rebuild`. **Scope:** MONOREPO-WIDE (not just agent-adapter-lib). **This is the breaking cut** — coexistence ends here: `index.ts` flips to the new surface, the old flat adapters are deleted, and every consumer migrates in lockstep so the whole monorepo is green together. **Prereqs:** ALL 11 adapters built + the consolidated fix committed + Phase E (conformance) green. **Conventions:** Biome, vitest, explicit `.ts` imports, `pnpm -r typecheck`/`pnpm test`/`pnpm check`.

## The three risks (from the gap analysis) all resolve here
1. **Consumer cascade:** 32+ files consume the OLD `AgentAdapter { invoke({system,user}): Promise<string>; events }`. They migrate to the NEW `AgentAdapter { invoke(AgentInput): Promise<AgentInvocationResult>; stream }`.
2. **Copilot auth:** copilot-cli's GH_TOKEN gap (Phase 0-adjacent) — surface the raw GitHub token from agent-auth, OR leave copilot-cli env-based (decide here).
3. **LangGraph extrication:** `LangGraphAdapter`/`HarnessChatModel` + the `@langchain/*` deps leave the lib (PRD D4) → a companion package; harness-server migrates.

## F0 — Discovery (do this first, in the executing task)
`grep -rl "@helmsmith/agent-adapter" --include="*.ts" . | grep -v node_modules | grep -v /agent-adapter-lib/` → the exact consumer inventory. For each, note WHAT it uses: `invoke`, `events`, `InvocationSpec`, `AgentAdapter` type, `LangGraphAdapter`/`HarnessChatModel`, `bindingToAdapter`, the old concrete adapters. Group by package (harness-core, harness-server, harness-pipeline-cli, context-loader-core, apps/pritty, + tests). Produce the migration checklist.

## F1 — Deps bump (isolated, first — unblocks live)
- Bump `@anthropic-ai/sdk` 0.30.1 → ≥0.93 (claude-agent-sdk peer) and `zod` 3.x → ^4 across the workspace. These are MAJOR bumps:
  - `@anthropic-ai/sdk` 0.30→0.93: the existing `claude-sdk` adapter (Phase B) + the old flat `claude-sdk-adapter.ts` + any other consumer of the Anthropic SDK may have API changes — fix call sites.
  - `zod` 3→4: repo-wide; check every `z.*` usage for v4 breaking changes.
- Run `pnpm -r typecheck && pnpm test` after each bump; fix fallout. Commit per-bump.

## F2 — LangGraph extrication
- Create companion `@helmsmith/agent-adapter-langchain` (new `core/agent-adapter-langchain-lib/`, or fold into harness): move `LangGraphAdapter` + `HarnessChatModel` + the `@langchain/core`/`@langchain/langgraph` deps there (out of agent-adapter-lib).
- Migrate harness-server (+ any other consumer) to import from the companion.
- Remove `@langchain/*` from agent-adapter-lib's `package.json` + delete the moved files from its `src/`.
- Green: `pnpm -r typecheck && pnpm test`.

## F3 — The surface flip + consumer migration (the big cut)
- **Flip `index.ts`:** export the NEW surface (`createAgent`, the new `AgentAdapter`/`AgentInput`/`AgentInvocationResult`/`AgentChunk`, `AgentSpec`, `capabilities`/`listAdapterTypes`, the registry, all 11 adapters auto-registered, `./conformance`). Remove the OLD exports (`InvocationSpec`, the old `AgentAdapter`, the old flat adapters, `bindingToAdapter`, `AdapterEventBus` if dropped). Move the new core types from `agent.ts` → `types.ts` (consolidate) and delete the old `types.ts`/`events.ts` content as appropriate.
- **Delete the old flat adapters:** `claude-sdk-adapter.ts`, `opencode-cli-adapter.ts`, `copilot-chat-adapter.ts`, `openai-chat-adapter.ts`, `binding-to-adapter.ts`, `opencode-server.ts` (relocate if a consumer needs it) + their tests.
- **Migrate each consumer** (per F0's checklist): `adapter.invoke({system,user})` → build an `AgentInput { messages:[{role:'user',content:user}], systemPrompt:system }`, call `invoke(input)`, read `result.content` (was the returned string). Construct adapters via `createAgent({ spec, workdir, credentialBroker })` instead of `bindingToAdapter`/direct. Replace `events` subscription with the new model (stream chunks or the result). For brokers: the new structural `CredentialBroker` (string param) — pass agent-auth's `FileBroker` wrapped (`(p)=>fileBroker.getCredential(p as Provider)`) at the call site (the deferred Phase-0 bridge).
- Run `pnpm -r typecheck && pnpm test` until the WHOLE monorepo is green. This is the moment coexistence ends — there is no half-migrated green state, so do it as one coherent pass (may be several commits, but the branch tip must end green).

## Verify (the whole monorepo)
- `pnpm -r typecheck` → 0 across ALL packages. `pnpm test` → all green (the 42 pre-existing SQLite/gitradar failures noted earlier are unrelated — confirm they're the same set, not new). `pnpm check` (biome) clean. `pnpm -r build` if applicable.
- The conformance suite (E) still passes for all 11 adapters through the new `index.ts`.

## Self-review
index.ts is the new surface; old flat adapters + old types/events gone; all 32+ consumers migrated to invoke(AgentInput)→AgentInvocationResult + createAgent; LangGraph in the companion (no @langchain in the lib); deps bumped (anthropic-sdk≥0.93, zod^4) with fallout fixed; the broker string↔Provider bridge at call sites; whole monorepo `pnpm -r typecheck && test && check` green. This is the merge-ready state → Phase G.
