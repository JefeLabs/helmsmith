# Flow Spec — Critical Feedback (Consolidated, Current)

**Date:** 2026-08-07 · **Updated:** 2026-08-12 after the data-plane slice (PR #14) and the hardening slice (PR #15) · Companion docs: [`SPEC.md`](../SPEC.md) · [`steps-and-edges.md`](./steps-and-edges.md) · [`next-steps.md`](./next-steps.md)

One document, every open criticism, with status. Sources: the pre-extraction design review (`docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`), the package-level critique from `SPEC.md` §7, the semantic findings from documentation-as-audit, and the 2026-08-12 data-plane review + its post-merge self-review (plan: `docs/superpowers/plans/2026-08-12-flow-spec-data-plane.md`). Items already fixed are listed once in §1 and not re-argued.

**Severity:** 🔴 can silently produce wrong behavior · 🟡 design debt that compounds · 🔵 polish / future-proofing

---

## 1. Resolved — for the record

### 1.1 Extraction + honesty (2026-08-07, PR #13)

| Finding | Resolution |
|---|---|
| Canonical spec was a dangling pointer (`.plans/flow-designer-spec-v1.0.md`) | Spec now lives as code in `@helmsmith/flow-spec`; stale references fixed |
| Dead config accepted silently (`policy`, `joinStrategy`, `terminal:'fail'`, non-manual triggers, `js`, fan-out) | `onUnsupported` seam + one `console.warn` line per finding in `loadCatalog` |
| `pipelines.json` / `flows.json` doc drift | Fixed in catalog.ts header |
| Evaluator locked to LangGraph's `FlowStateT` | Retyped to structural `unknown`; browser consumers can share it |
| Expression semantics undocumented/unpinned (dot-numeric array indexing, SameValueZero `in`, reference-equality `==`) | Documented + pinned: fixtures (JSON-serializability guarded) + NaN code-level test; runtime replays fixtures in `flow-spec-conformance.test.ts` |
| No compatibility proof for the extraction | Baseline 216 → 230 tests verified via stash comparison; 211 external-consumer tests untouched |

### 1.2 Data plane (2026-08-12, PR #14)

| Finding | Resolution |
|---|---|
| 🔴 **The data plane was one flat string** — `state.output` was the only inter-node channel, so the expression language routed over structured state the runtime could never produce: `$.input` didn't exist (despite appearing in types.ts doc examples), `$.nodes` didn't exist, `$.output.field` silently resolved `undefined` → false. The routing plane was spec'd; the data plane wasn't (the review's headline finding) | `FlowRunState` wire contract in the spec; runtime channels `input` (write-once) + `nodes` (merge-reduced, parallel-safe) with `FlowStateT extends FlowRunState` compile-time-asserted; fixtures pin `$.input` / `$.nodes.<id>` semantics |
| 🔴 No per-node structured output — gates/edges could only see one opaque string; the runtime scraped JSON ad hoc (`extractPrUrlFromOutput`) | `NodeOutputContract` (`output.kind: 'json'`) — output parsed into `state.nodes[id]`; `OutputParseError` is error-edge routable. Schema enforcement still open (§3, `node-output-schema`) |
| 🔴 No node input mapping — every node implicitly consumed the previous node's output string; multi-input nodes impossible | `TaskStep.input` (Expression or Record) resolved against run state into the effective prompt/stdin/input; runs inside Loop so mappings see per-item state |
| 🟡 Error routing untyped — one catch-all error edge despite a rich AdapterError taxonomy; timeout ≠ rate-limit ≠ parse failure indistinguishable | `ErrorEdge.on` matchers against `NodeExit.errorName`; any number of named edges + ≤1 catch-all; first declared match wins |
| 🟡 Expression language couldn't shape data or distinguish false-from-missing; string routing ("did the agent say APPROVED") needed a script hop | `exists` (presence ≠ truthiness), `object`/`array` constructors, `contains`/`startsWith`/`endsWith`/`matches` string ops; `matches` literal patterns validated at load; fixtures extended to 28 incl. `expectedValue` value-semantics pins |
| 🟡 Run-side wire shapes were runtime-private — HITL request/resume payloads, `NodeExit`, `ChangedFile` lived in harness-core, so a reviewer UI had no contract to build against | Moved to flow-spec (`ApprovalRequest`/`ApprovalResume`, `SuspendRequest`, `NodeExit`, `ChangedFile`); harness-core re-exports for compatibility |
| 🟡 Scripts had no credential surface — tools got `ToolAuthRef`, scripts got plain-string env, inviting pasted secrets | `ScriptConfig.secrets` resolved through the CredentialBroker into child env (wins over static env); missing broker / bad id → `AuthError` exit |
| 🔵 Flows had no version identity for durable checkpoints or subflow pins | `FlowDef.version` + `SubflowConfig.version` (pin recorded, not enforced — `subflow-version-pin` report) |
| 🔵 No `test` script in package.json (`pnpm -r test` skipped the contract's own suite) | Added (`vitest run`) |

### 1.3 Hardening (2026-08-12, PR #15 — findings from the post-merge self-review of PR #14)

| Finding | Resolution |
|---|---|
| 🔴 `loop` + `output.kind: 'json'` was a guaranteed failure on 2+ items — the `\n---\n` join is never valid JSON, so every multi-item json loop exited OutputParseError (passes the single-item demo, fails production) | json-declaring looped nodes aggregate a JSON **array**; `$.nodes.<id>` = per-iteration values; a non-JSON item fails the array parse (correct semantic), pinned by tests |
| 🔴 Flow-level output contracts had types and a static check, zero runtime parsing — the factory/fleet seam was toothless (and, after PR #14, embarrassingly so: the node-level parse machinery existed) | `parseFlowOutput` in the spec (job-intent/job-intents shape checks + min/max, flow-spec emissions re-validated through the catalog validator, structured parse-only); `finalizeOrPause` enforces before 'completed' and records `job.flowOutput`; schema stays honest via `flow-output-schema` report |
| 🔴 The `onUnsupported` list ran on convention; conformance covered 1 of 3 behaviors (validation verdicts + warning expectations were code-locked in `validate.test.ts`) | `VALIDATION_CASES` + `UNSUPPORTED_CASES` fixtures (JSON-serializable), replayed by spec + runtime with **exact-set** feature match — a stale report after implementing a feature, or a missing report on new dead config, now fails both suites until the fixture changes first |
| 🟡 Scripts couldn't see the data plane — `serializableStateView` predated the new channels, so `HARNESS_STATE_JSON` lacked `input`/`nodes` while docs claimed "full state"; no compile-time tie to `FlowRunState` | `input` included; `nodes` deliberately excluded (env-size — `input` mappings via stdin are the channel); return type is now `Omit<FlowRunState, …>` so contract growth forces an explicit decision; docs corrected |

## 2. Open — package-level (this package's debt)

### 🟡 The export surface is unguarded — and growing
`index.ts` wildcard-exports five modules, and harness-core's `catalog.ts` wildcard-exports the package again. Any new symbol becomes public API of two packages with no review point — and both 2026-08-12 slices pushed ~a dozen new symbols through it (`FlowRunState`, HITL shapes, `parseFlowOutput`, fixture types…). Still the cheapest high-leverage fix in the package (next-steps 0.1), and more urgent each slice: curated named exports at both layers.

### 🟡 `AdapterId` bakes two runtime implementations into the wire contract
`'claude-sdk' | 'opencode-cli'` is a closed union in the *spec* package — adding an adapter is a spec change. Everything else in the contract references by id and resolves at runtime (`toolId`, `flowId`); adapters should work the same way (`string` + registry check).

### 🟡 The name undersells the scope — it's the platform wire-contract package now
Originally: `ProductDef`/`ProductRepo`/`ContextSourceDef` (tenancy/git shapes) live here because `validateUnifiedCatalog` needs them. Since 2026-08-12 the run side (`FlowRunState`, HITL payloads, `NodeExit`, `ChangedFile`) lives here too — deliberately, for the shared-contract reasons in SPEC §3.1.2. Defensible, but a designer UI importing "flow types" now drags in clone-URL shapes and reviewer payloads. Rename, split entry points, or at least curate exports (0.1) when the designer becomes real.

### 🟡 Tool nodes have two overlapping input mechanisms
`ToolConfig.args` values were already expression-resolvable; `TaskStep.input` (2026-08-12) now exists on the same node. Both answer "how does state reach this tool?" with different semantics — args merge into the ToolDef template, input rewrites the node's effective `$.output`. The spec doesn't say which to prefer or define their composition. A designer UI will surface this ambiguity immediately; pick a rule (suggest: `input` composes the payload, `args` binds it to the tool's parameters) and document it.

### 🟡 Runtime seams migrated with the types
`ToolResolver` (`(toolId) => ToolDef | undefined`) is a dispatch signature, not a wire shape — it can't be stored or rendered. Softer versions of the same question: `walkAgents`, `resolveAccepts`. They rode along in the verbatim move; the export-surface curation (above) is the natural moment to decide their home.

### 🟡 No schema artifact
Controlplane still stores opaque JSONB; Phase 2 would hand-port these rules into Java, and the smithagents seam wants a language-neutral contract. Generated JSON Schema from these types is the agreed answer and doesn't exist yet. The 2026-08-12 fixtures make this *safer* (a ported validator has three replayable behavior sets to conform to) but not less necessary.

### 🔵 Input delivery is stringly
`input` mappings resolve structured values, then serialize to one string through `state.output`. Right for agents (prompts) and scripts (stdin); wasteful for transform/gate consumers that re-parse what was just serialized. A structured hand-off (an `$.inputView` state slot or executor parameter) is the eventual fix; not urgent.

### 🔵 Wire-format warts locked in 2026-08-12
(a) Input-mapping keys must not be named `kind` — the single-Expression detection heuristic; `{ expr: … } | { map: … }` would have been unambiguous. (b) The write-once `input` reducer treats a legitimately-`null` job input as claimable by a later write; node writes to `input` are prevented by convention only. (c) `nodes` duplicates every output alongside `output` with no truncation policy — irrelevant in-memory, becomes checkpoint-size growth when the durable checkpointer (2.2) lands.

### 🔵 `scanForJsExpressions` can false-positive on inert data
A `literal` whose `value` contains `{kind:'js', expression:'…'}` is reported as a js expression though it's never evaluated. Warning-only today; walking known expression positions (edge conditions, assertions, transform expressions, loop paths, matchers, tool args, input mappings) would be precise.

### 🔵 Packaging hygiene
Version 0.0.0/private with no changeset wiring despite semver being a stated extraction motive. Fine today, wrong the day the first out-of-repo consumer appears. (The missing `test` script was fixed 2026-08-12.)

## 3. Open — runtime-level (harness-core's debt, visible through the spec)

Inherited from the original review, minus what the 2026-08-12 slices closed (terminal output enforcement moved to §1.3). Everything below is warned at load where the spec can see it.

| Gap | Severity | Current truth |
|---|---|---|
| `policy` retry/timeout/onError, `joinStrategy`, `terminal:'fail'` | 🔴 | Warned at load, ignored at runtime — authors' reliability config does nothing |
| Parallel fan-out/join | 🔴 | Router follows first sequence edge only; second+ branches never run (warned). **Note:** the state-model blocker is gone — `nodes` is merge-reduced, so branches can't clobber addressable outputs; what remains is genuinely just router/join work (next-steps 2.4) |
| Approval `slaMs` / `assigneeRole` | 🔴 | No auto-reject timer; resume route checks only job status — any caller with socket access can approve. Sharper now that `ApprovalRequest` is an exported spec contract |
| Durability | 🔴 | `MemorySaver` default checkpointer: restart loses every awaiting-approval/suspended job; durable savers supported but never wired. When 2.2 lands, `effect` consultation (below) must land with it |
| JobIntent emission | 🟡 | New gap exposed by closing 2.5: the terminal intent is now parsed, enforced, and recorded on `job.flowOutput` — but nothing *submits* it to a JobStateMachine. Enforcement without emission (next-steps 2.9) |
| Output schemas, effect-aware replay | 🟡 | Honestly reported: `output.schema`/`structured.schema` accepted but never validated (`node-output-schema`/`flow-output-schema`); `effect` recorded but not consulted (`effect`) — becomes 🔴 the day a durable checkpointer starts replaying side-effecting nodes (duplicate PRs) |
| Non-manual triggers | 🟡 | Validated cron/webhook/event/message shapes with no ingress, scheduler, or subscription behind them (warned) |
| Suspend wake-ups | 🟡 | No timer/event scheduler; resume is entirely the caller's job |
| Loop state semantics | 🟡 | Only last iteration's non-output state delta survives; chunked parallelism; no sibling cancellation. (The loop+json aggregation defect itself is fixed — §1.3) |
| Subflow v1-light | 🟡 | No agents or interrupt tags inside subflows (compile-time ban — honest, but limits composition) |
| Synthetic interrupt nodes typed as `kind:'agent'` | 🔵 | Type-system lie with cast placeholder configs; future walkers over rewritten flows will trip |
| `changedFiles` only grows | 🔵 | Reverted files stay in the reviewer's diff surface (documented as intentional; still surprising) |
| Legacy coordinator filter | 🔵 | `linearFlowFromAgents` hardcodes skipping ids `coordinator`/`checkout-coordinator` |

## 4. The one-sentence summary

The extraction fixed the *honesty* problem (2026-08-07), the data-plane pass fixed the *capability ceiling*, and the hardening pass turned the alignment mechanisms into enforced tests (three-behavior conformance fixtures) while giving the factory/fleet seam teeth (terminal output enforcement) — what remains is the reliability tier (policy/join/triggers/fan-out still warn-only, with 2.4's state-model excuse now gone), schema/effect enforcement, HITL trust (role check, SLA, durable checkpointer), and JobIntent *emission* on top of the now-enforced contract.
