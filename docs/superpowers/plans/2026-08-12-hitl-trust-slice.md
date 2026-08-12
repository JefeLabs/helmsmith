# HITL Trust Slice (roadmap 2.8 + 2.2 + 2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HITL production-trustworthy: effect-aware replay (2.8), durable checkpointer + restart survival for paused jobs (2.2), and approval SLA auto-reject + role check on the resume route (2.1).

**Architecture:** 2.8 adds an outermost `withEffectGuard` to flow-graph's node-wrapper chain (at-most-once semantics for `effect: 'side-effecting'` nodes, keyed on `state.nodes[id]` completion evidence) plus natural-key idempotency in publish-executor; the `effect` unsupported-report is deleted fixture-first per the flow-spec honesty rule. 2.2 threads an injectable `BaseCheckpointSaver` through `RunJobDeps` → `compileFlow`, teaches `resumeJob` to recompile from `job.flow` on graph-cache miss, defaults harness-server to a SqliteSaver at `<workspace>/.harness/state/checkpoints.sqlite`, and persists paused JobRecords as JSON files rehydrated at boot. 2.1 arms an unref'd SLA timer per pending approval (server-side, re-armed on rehydration with remaining time) that auto-rejects through the same resume path, and enforces `X-Actor-Role` == `ApprovalRequest.assigneeRole` (plus `decision` body validation) on `POST /v1/jobs/:id/resume`.

**Tech Stack:** TypeScript, LangGraph ^1.3 (`BaseCheckpointSaver`, `MemorySaver`, `Command`), `@langchain/langgraph-checkpoint-sqlite` ^1.0.3 (new, harness-server only), vitest.

## Global Constraints

- Roadmap ordering: 2.8 lands WITH or BEFORE 2.2 (replay + `push-and-open-pr` without the guard = duplicate PRs). Task order below satisfies this.
- flow-spec honesty rule: the change implementing `effect` deletes its `onUnsupported` report, fixture first (`UNSUPPORTED_CASES` exact-set match is enforced in BOTH packages).
- flow-spec stays browser-safe / zero-runtime-dep; the sqlite dependency goes in harness-server ONLY. harness-core gets only the `BaseCheckpointSaver` type (already available via `@langchain/langgraph`).
- Dependency direction: harness-core → flow-spec, never back; harness-server → harness-core.
- TDD throughout: watch each new test fail before implementing. Existing suites must stay green: flow-spec 82, harness-core 277, harness-server (vitest), workspace `pnpm -r typecheck`.
- gh pushes to JefeLabs need `gh auth switch --user ecruz165` (edwin-skoolscout keeps becoming active and 403s).
- Branch: `feat/hitl-trust-slice`. One commit per task.
- Out of scope (explicitly): Postgres saver (seam only), suspend wake-up scheduling (roadmap 2.6), subflow checkpointer sharing (subflow-executor.ts:347-350 comment), persistence of `running` jobs (paused jobs only), real authn (role check is header-asserted identity over the already-0600-scoped UDS transport).

## Code anchors (from the 2026-08-12 exploration; verify before editing — lines may drift)

- Wrapper chain (every node): harness-core/src/flow-graph.ts:280 — `withNodeIO(node, wrapWithTags(node, withInputMapping(node, baseExec)))`
- `withNodeIO`: flow-graph.ts:583-605; evidence write gated on `delta.output !== undefined` && success exit
- Checkpointer construction: flow-graph.ts:312 (`opts.checkpointer ?? new MemorySaver()`); `CompileFlowOptions.checkpointer` exists at flow-graph.ts:230
- `runJob` compile site: orchestrator.ts:534 (`compileFlow({ flow, executors })`); executor construction inline at :456-532; subflow pre-compile :432-449
- `resumeJob`: orchestrator.ts:576-606 — silently returns on missing job (:581), throws on missing cached graph (:584-589), no status check, `new Command({ resume })` at :598
- thread_id = bare jobId in 5 places: orchestrator.ts:543, :594, :657, :684, :702
- `finalizeOrPause`: orchestrator.ts:772-828; interrupt extraction :830-851; pending hooks fire :784 (approval), :788 (suspend)
- Server dep literals (add `checkpointer:` to each): harness-server/src/index.ts:1155, :1291, :1337, :1382
- Server hooks that stash pending requests: index.ts:1182-1194 (runJob path), :1293-1298 (resume path); cleared at :1251-1252 and :1274-1275 (terminal-status callback)
- `handleResumeJob`: index.ts:1222-1301; status gate :1233-1239 (enforcement point for role check)
- In-memory stores: `jobs` Map index.ts:359; `graphs` :374; `pendingApprovals`/`pendingSuspends` :375-376; `ServerCtx` :443-515
- Publish PR creation (unguarded): publish-executor.ts:119-125 (`POST /pulls`); merge :142-187; `ghApi` throw :267-270
- Effect report to delete: flow-spec/src/validate.ts:338-343 (in `reportUnsupportedFeatures`); fixture `UNSUPPORTED_CASES` kitchen-sink expects `'effect'`
- Test patterns to copy: orchestrator.test.ts:1254-1375 (runJob+resumeJob approval), flow-graph.test.ts:1010-1141 (raw Command resume), harness-server/src/approval-resume-integration.test.ts (UDS round-trip, `approvalFlow()` :71-113, `udsJson` :333-358, `waitFor` :360-367)

---

### Task 1: Effect-aware replay guard in the wrapper chain (2.8a)

**Files:**
- Modify: `platform/harness/harness-core/src/flow-graph.ts` (wrapper chain ~:280, new function near `withNodeIO`)
- Test: `platform/harness/harness-core/src/flow-graph.test.ts`

**Interfaces:**
- Produces: `withEffectGuard(step: TaskStep, exec: NodeExecutor): NodeExecutor` (module-private), wired outermost in the chain. Skip semantics: `step.effect === 'side-effecting'` AND `state.nodes[step.id] !== undefined` → return recorded output without executing.

- [ ] **Step 1: Write the failing test** — in flow-graph.test.ts, a reject-cycle flow that re-enters a side-effecting node:

```ts
describe('effect-aware replay guard', () => {
  const flowWithEffect = (effect?: 'pure' | 'idempotent' | 'side-effecting'): FlowDef => ({
    id: 'fx',
    nodes: [
      { id: 't', kind: 'trigger', config: { kind: 'manual' } },
      { id: 'work', kind: 'transform', config: { expression: { kind: 'literal', value: 'w' } } },
      { id: 'ship', kind: 'transform', effect, config: { expression: { kind: 'literal', value: 'shipped' } } },
      { id: 'check', kind: 'gate', config: { assertions: [
        { expression: { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.attempts.check' }, op: '>=', rhs: { kind: 'literal', value: 1 } }, message: 'pass on 2nd attempt' },
      ] } },
    ],
    edges: [
      { from: 't', to: 'work', type: 'sequence' },
      { from: 'work', to: 'ship', type: 'sequence' },
      { from: 'ship', to: 'check', type: 'sequence' },
      { from: 'check', to: 'work', type: 'reject', maxAttempts: 3 },
    ],
  });
  // Count executions via a counting executor for 'ship' instead of transform if
  // transform executors are built-in — use the executors map with a custom
  // NodeExecutor that increments a counter and returns { output: 'shipped' }.
  it('skips a side-effecting node on re-entry when completion evidence exists', async () => {
    let shipRuns = 0;
    // compileFlow with executors: { ship: counting executor }, invoke, expect gate
    // rejects once (attempt 0 fails assertion), cycle re-runs work → ship → check;
    // second gate attempt passes. Assert shipRuns === 1 for effect 'side-effecting'.
    expect(shipRuns).toBe(1);
  });
  it('re-runs an idempotent node on re-entry', async () => {
    // same flow, effect: 'idempotent' → shipRuns === 2
  });
});
```

Adapt the harness to the file's existing compile/invoke helpers (thread_id config pattern at flow-graph.test.ts:1091). The gate assertion above passes on the second attempt because `attempts.check` increments on each gate rejection (gate executor writes `attempts`, flow-graph.ts:463-471).

- [ ] **Step 2: Run to verify both tests fail** — `cd platform/harness/harness-core && npx vitest run src/flow-graph.test.ts -t 'effect-aware'`. Expected: side-effecting case counts 2 runs (no guard exists).

- [ ] **Step 3: Implement `withEffectGuard`** in flow-graph.ts, wired outermost at the :280 chain:

```ts
/** At-most-once execution for side-effecting nodes: when completion
 *  evidence exists in state.nodes[id], re-entry (reject cycles,
 *  checkpointer replay after resume/restart) returns the recorded
 *  output instead of re-running. `idempotent`/`pure`/unset re-run
 *  freely — authors who WANT re-publish semantics mark the node
 *  idempotent and rely on the executor's natural-key idempotency. */
function withEffectGuard(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  if (step.effect !== 'side-effecting') return exec;
  return async (state) => {
    const prior = (state.nodes as Record<string, unknown> | undefined)?.[step.id];
    if (prior !== undefined) {
      return {
        output: typeof prior === 'string' ? prior : JSON.stringify(prior),
        lastExit: { nodeId: step.id, kind: 'success' as const },
      };
    }
    return exec(state);
  };
}
```

Chain becomes `withEffectGuard(node, withNodeIO(node, wrapWithTags(node, withInputMapping(node, baseExec))))`. Guard is OUTERMOST so a skip bypasses input-mapping and JSON re-parse too (nodes[id] already holds the parsed value). Note in a comment: synthetic interrupt nodes never carry `effect` (the rewriter's synthetic node omits it), and a looped side-effecting node is skipped as a whole unit — at-most-once is per node, not per iteration.

- [ ] **Step 4: Verify green** — targeted run, then full `npx vitest run` (277 existing must stay green) and `npx tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(harness-core): effect-aware replay guard — side-effecting nodes run at most once (2.8)`

### Task 2: Delete the `effect` unsupported-report, fixture first (2.8b)

**Files:**
- Modify: `platform/harness/flow-spec/src/fixtures.ts` (kitchen-sink `expectedFeatures`; 'fully-executed' case gains an `effect` declaration)
- Modify: `platform/harness/flow-spec/src/validate.ts` (delete report block :338-343 and the id from the doc comment)
- Modify: `platform/harness/flow-spec/src/validate.test.ts` (the code-level test expecting 'effect')
- Docs: flow-spec `README.md` (onUnsupported table row), `SPEC.md` §5 list + §3.1.1 effect bullet, `docs/steps-and-edges.md` §6 row + node-fields row

**Interfaces:** Consumes Task 1 (the runtime now consults `effect`, making report deletion honest).

- [ ] **Step 1 (RED):** In fixtures.ts kitchen-sink case: remove `'effect'` from `expectedFeatures` (keep the node's `effect: 'pure'` declaration — that IS the pin that it no longer reports). In the 'fully-executed' case add `effect: 'side-effecting'` to the script node (expectedFeatures stays `[]`). Run `npm test` in flow-spec → the kitchen-sink UNSUPPORTED case fails (validator still reports 'effect').
- [ ] **Step 2 (GREEN):** Delete the `node.effect !== undefined` report block in validate.ts `reportUnsupportedFeatures` and remove `effect` from the `UnsupportedFeature` doc-comment id list. Update validate.test.ts 'reports node-output-schema, effect, and subflow-version-pin': drop the 'effect' expectation (keep the node's declaration to pin silence). flow-spec suite green.
- [ ] **Step 3:** Run harness-core conformance (`npx vitest run src/flow-spec-conformance.test.ts`) — green because fixtures are the shared source.
- [ ] **Step 4:** Docs: README onUnsupported table — delete the `effect` row; SPEC §5 — remove `effect` from the fires-for list, move to the "deliberately NOT reported because they execute" list with "(side-effecting nodes are skipped on re-entry when completion evidence exists)"; SPEC §3.1.1 `effect` bullet — replace "(declared only, §5)" with executed semantics; steps-and-edges §6 — delete the `effect` row; §4 node-fields table — `effect` row becomes ✅ with one-line semantics.
- [ ] **Step 5: Commit** — `feat(flow-spec): effect is executed — report deleted fixture-first (2.8)`

### Task 3: Publish idempotency by natural key (2.8c)

**Files:**
- Modify: `platform/harness/harness-core/src/publish-executor.ts` (`runPushAndOpenPr` ~:71-136, `runMergePr` ~:142-187)
- Test: `platform/harness/harness-core/src/publish-executor.test.ts` (follow the file's existing mock pattern for `ghApi`/fetch — read it first)

**Interfaces:** No signature changes. Behavior: `push-and-open-pr` looks up an existing open PR for the head branch (`GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`) before `POST /pulls`, and reuses `{ prUrl, prNumber, branchName }` when found; `merge-pr` returns `{ mergeSha: job.mergeSha }` without an API call when `job.mergeSha` is already set.

- [ ] **Step 1 (RED):** Two tests: (a) when the pulls listing returns one open PR for the head branch, no `POST /pulls` request is made and the output/`job.prUrl` reuse the existing PR's `html_url`/`number`; (b) `merge-pr` with `job.mergeSha` preset performs no API call and exits success with the same sha. Watch both fail.
- [ ] **Step 2 (GREEN):** Implement the GET-before-POST lookup (the natural idempotency key is the branch name — one PR per head→base pair is GitHub's own constraint, the 422 today) and the mergeSha short-circuit. Keep the push itself unconditional (git push of the same commits is inherently idempotent).
- [ ] **Step 3:** Full harness-core suite + typecheck green.
- [ ] **Step 4: Commit** — `feat(harness-core): publish executors idempotent by natural key (2.8)`

### Task 4: Injectable checkpointer + recompile-on-resume (2.2a, core)

**Files:**
- Modify: `platform/harness/harness-core/src/orchestrator.ts` — `RunJobDeps` gains `checkpointer?: BaseCheckpointSaver`; extract the inline executor-construction + compile block (:432-539) into `compileJobGraph(job: JobRecord, flow: FlowDef, deps: RunJobDeps): CompiledFlowGraph` used by `runJob` AND `resumeJob`; `resumeJob` gains a status guard and a recompile path.
- Test: `platform/harness/harness-core/src/orchestrator.test.ts`

**Interfaces:**
- Produces: `RunJobDeps.checkpointer?: BaseCheckpointSaver` (type import from `@langchain/langgraph`); `resumeJob` now throws `"job <id> is not paused (status: <s>)"` unless status is `awaiting-approval`/`suspended`, and recompiles from `job.flow ?? linearFlowFromAgents(...)` when `deps.graphs` has no entry — the old "no cached graph" throw remains only when no flow is recoverable either.
- `compileJobGraph` passes `deps.checkpointer` through to `compileFlow({ flow, executors, checkpointer })`. IMPORTANT: recompile-on-resume only restores the interrupt when the SAME saver instance (or a durable one reopened on the same storage) is supplied — MemorySaver default keeps old single-process semantics.

- [ ] **Step 1 (RED):** Test in orchestrator.test.ts (copy the :1254-1375 harness): run the approval flow with `deps.checkpointer = new MemorySaver()` held in the deps object; after `awaiting-approval`, `graphs.delete(jobId)`; `resumeJob` with the same deps → job completes (currently throws "no cached graph"). Second test: `resumeJob` on a `completed` job throws the not-paused error.
- [ ] **Step 2 (GREEN):** Extract `compileJobGraph` (verbatim move of :432-539 minus status set), add the two `resumeJob` behaviors, thread `checkpointer` through.
- [ ] **Step 3:** Full suite + typecheck. Existing resume tests keep passing (they resume paused jobs with cached graphs).
- [ ] **Step 4: Commit** — `feat(harness-core): injectable checkpointer + recompile-on-resume (2.2)`

### Task 5: harness-server durable saver + paused-job rehydration (2.2b)

**Files:**
- Modify: `platform/harness/harness-server/package.json` — add `"@langchain/langgraph-checkpoint-sqlite": "^1.0.3"`; run `pnpm install` (better-sqlite3 build already approved at root package.json:76).
- Create: `platform/harness/harness-server/src/paused-jobs.ts` — JSON-file persistence for paused jobs.
- Modify: `platform/harness/harness-server/src/index.ts` — build SqliteSaver at startup, `ServerCtx.checkpointer`, pass into the four dep literals; save on pause hooks, delete on resume/terminal; rehydrate at boot.
- Test: `platform/harness/harness-server/src/paused-jobs.test.ts` (unit) + a restart case in a new `platform/harness/harness-server/src/restart-rehydration.test.ts` (integration, reuse `approvalFlow`/`udsJson`/`waitFor` patterns).

**Interfaces (paused-jobs.ts):**

```ts
export interface PausedJobFile {
  job: JobRecord;                      // JobRecord is plain data (flow, agents included)
  kind: 'approval' | 'suspend';
  request: ApprovalRequest | SuspendRequest;
  pausedAt: string;                    // ISO — SLA re-arm math reads this
}
export function savePausedJob(stateDir: string, file: PausedJobFile): Promise<void>;   // <stateDir>/paused/<jobId>.json, mkdir -p
export function deletePausedJob(stateDir: string, jobId: string): Promise<void>;       // ENOENT-tolerant
export function loadPausedJobs(stateDir: string): Promise<PausedJobFile[]>;            // [] when dir missing; skip+warn unparseable files
```

- Saver: `SqliteSaver.fromConnString(join(workspaceRoot, '.harness', 'state', 'checkpoints.sqlite'))` (mkdir the dir first); `stateDir = join(workspaceRoot, '.harness', 'state')`.
- Boot rehydration: for each loaded file → `ctx.jobs.set`, `ctx.pendingApprovals/pendingSuspends.set`; graph recompiles lazily via Task 4's resume path (`ServerCtx.graphs` doc at index.ts:451-460 anticipated exactly this).
- Save sites: the two onAwaitingApproval hooks (index.ts:1182-1191, :1293-1298) and onSuspend equivalents. Delete sites: handleResumeJob (:1251-1252) and the terminal-status callback (:1274-1275). Fire-and-forget with `.catch(console.warn)` — persistence must not block the response path.

- [ ] **Step 1 (RED):** unit tests for save/load/delete round-trip incl. missing-dir load and corrupt-file skip; integration test: start server A on a temp workspace, run approval flow to `awaiting-approval`, close server A, start server B on the same workspace root, `GET /v1/jobs/:id/approval` returns the request, `POST resume {decision:'approve'}` (with role header once Task 7 lands — write it with the header from the start) → job completes.
- [ ] **Step 2 (GREEN):** implement paused-jobs.ts, wire saver + persistence + rehydration.
- [ ] **Step 3:** harness-server suite + typecheck + `pnpm -r typecheck`.
- [ ] **Step 4: Commit** — `feat(harness-server): sqlite checkpointer + paused-job rehydration — HITL survives restarts (2.2)`

### Task 6: SLA auto-reject timer (2.1a)

**Files:**
- Modify: `platform/harness/harness-server/src/index.ts` — `ServerCtx.approvalTimers: Map<string, NodeJS.Timeout>`; `armSlaTimer(ctx, jobId, request, pausedAtIso)`; extract the resume-execution body of `handleResumeJob` (:1284-1300 microtask block) into `executeResume(ctx, jobId, resumeValue)` so the timer and the HTTP route share one path.
- Test: extend `restart-rehydration.test.ts` or `approval-resume-integration.test.ts`.

**Interfaces:**
- `armSlaTimer`: remaining = `request.slaMs - (Date.now() - Date.parse(pausedAtIso))`; fire immediately when ≤ 0. On fire: only if `ctx.pendingApprovals.has(jobId)` and `job.status === 'awaiting-approval'` → `executeResume(ctx, jobId, { decision: 'reject', steering: 'auto-rejected: approval SLA of <slaMs>ms expired' })`. Timers `.unref()`d; cleared+deleted at both delete sites (resume, terminal) and re-armed during boot rehydration.

- [ ] **Step 1 (RED):** integration test — approval flow with `slaMs: 120`; do NOT resume; `waitFor` the job to leave `awaiting-approval`; assert the reject path ran (flow's reject edge re-runs the worker: adapter call count rises, or with maxAttempts 1 the job fails) and `pendingApprovals` is empty. Also: manual resume BEFORE expiry then wait past `slaMs` → status stays `completed` (timer cancelled).
- [ ] **Step 2 (GREEN):** implement registry + arm/cancel/re-arm.
- [ ] **Step 3:** suite green.
- [ ] **Step 4: Commit** — `feat(harness-server): approval SLA auto-reject timer (2.1)`

### Task 7: Role check + resume-body validation (2.1b)

**Files:**
- Modify: `platform/harness/harness-server/src/index.ts` — `handleResumeJob` gains, for approval resumes only (job in `pendingApprovals`): body validation (`decision` must be `'approve' | 'reject'` → 400 otherwise) and role enforcement (`x-actor-role` header must exactly equal `request.assigneeRole` → 403 when missing or mismatched). Suspend resumes unchanged (no role on SuspendTag; executor discards the body). `route()` must pass `req` headers through to the handler (today it doesn't — smallest change: hand `req` to `handleResumeJob`).
- Modify: `platform/harness/harness-server/src/approval-resume-integration.test.ts` — existing approve/reject calls gain the `x-actor-role` header (the `approvalFlow()` fixture's `assigneeRole` value).
- Test: new cases in the same file.

**Interfaces:** 403 body `{ error: 'role <got|none> is not authorized; approval requires role <assigneeRole>' }`; 400 body `{ error: "decision must be 'approve' or 'reject'" }`. SLA auto-reject bypasses the role gate by construction (it calls `executeResume` directly, not the HTTP route) — note this in a comment: the timer is the server acting as itself.

- [ ] **Step 1 (RED):** three new cases — missing header → 403; wrong role → 403; `decision: 'banana'` → 400; and the updated happy-path tests (which now fail until the header pass-through exists… they pass today; they fail only if enforcement lands first — order: write 403/400 tests, watch fail, then implement, then add headers to existing tests in the same step).
- [ ] **Step 2 (GREEN):** implement; update `udsJson` to accept optional headers.
- [ ] **Step 3:** harness-server suite + full workspace typecheck.
- [ ] **Step 4: Commit** — `feat(harness-server): role check + body validation on resume route (2.1)`

### Task 8: Docs + roadmap + memory

**Files:**
- Modify: flow-spec `docs/next-steps.md` — strike 2.1, 2.2, 2.8 with ✅ notes (2.2 note: SQLite default + paused-job rehydration; PG = config swap through the same seam. 2.6 suspend wake-ups and subflow saver sharing remain open).
- Modify: flow-spec `docs/critical-feedback.md` — §3 rows: Approval `slaMs`/`assigneeRole` → resolved (note header-asserted identity over 0600 UDS; real authn still open); Durability → resolved for paused jobs; "Output schemas, effect-aware replay" row → effect half resolved, schema half remains; §4 summary sentence updated; header Updated line.
- Modify: flow-spec `SPEC.md`/`README.md` residuals if any missed in Task 2.

- [ ] **Step 1:** Make the doc edits; re-read each edited section for coherence (resolved items move to the record, open items stay accurate).
- [ ] **Step 2:** Run both flow-spec + harness-core suites one final time (conformance replays fixtures; docs must match reports).
- [ ] **Step 3: Commit** — `docs(flow-spec): HITL trust slice recorded — 2.1/2.2/2.8 struck, ledger updated`
- [ ] **Step 4:** PR `feat/hitl-trust-slice` → main with verification evidence; update auto-memory flow-spec-review entry after merge.

## Self-review notes

- Spec coverage: 2.8 = Tasks 1-3 (guard, honesty, publish idempotency); 2.2 = Tasks 4-5 (core seam, server default + restart survival); 2.1 = Tasks 6-7 (SLA, role). Docs = Task 8. Roadmap's "2.8 before 2.2" holds.
- Known risk: orchestrator extraction (Task 4) moves ~100 inline lines; mitigate by verbatim move + full suite after.
- Known risk: sqlite native build under pnpm 9 (`onlyBuiltDependencies` in root package.json already lists better-sqlite3; verify install output).
- Type consistency: `PausedJobFile.request` uses flow-spec's `ApprovalRequest | SuspendRequest` (exported); `executeResume(ctx, jobId, resumeValue)` is the single resume entry shared by route + timer.
