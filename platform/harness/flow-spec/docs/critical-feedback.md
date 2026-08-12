# Flow Spec — Critical Feedback (Consolidated, Current)

**Date:** 2026-08-07 · **Updated:** 2026-08-12 (data-plane critique + resolution) · Companion docs: [`SPEC.md`](../SPEC.md) · [`steps-and-edges.md`](./steps-and-edges.md) · [`next-steps.md`](./next-steps.md)

One document, every open criticism, with status. Sources: the pre-extraction design review (`docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`), the package-level critique from `SPEC.md` §7, the semantic findings from documentation-as-audit, and the 2026-08-12 data-plane review (plan: `docs/superpowers/plans/2026-08-12-flow-spec-data-plane.md`). Items already fixed are listed once in §1 and not re-argued.

**Severity:** 🔴 can silently produce wrong behavior · 🟡 design debt that compounds · 🔵 polish / future-proofing

---

## 1. Resolved — for the record

| Finding | Resolution |
|---|---|
| Canonical spec was a dangling pointer (`.plans/flow-designer-spec-v1.0.md`) | Spec now lives as code in `@helmsmith/flow-spec`; stale references fixed |
| Dead config accepted silently (`policy`, `joinStrategy`, `terminal:'fail'`, non-manual triggers, `js`, fan-out) | `onUnsupported` seam + one `console.warn` line per finding in `loadCatalog` |
| `pipelines.json` / `flows.json` doc drift | Fixed in catalog.ts header |
| Evaluator locked to LangGraph's `FlowStateT` | Retyped to structural `unknown`; browser consumers can share it |
| Expression semantics undocumented/unpinned (dot-numeric array indexing, SameValueZero `in`, reference-equality `==`) | Documented + pinned: fixtures (JSON-serializability guarded) + NaN code-level test; runtime replays fixtures in `flow-spec-conformance.test.ts` |
| No compatibility proof for the extraction | Baseline 216 → 230 tests verified via stash comparison; 211 external-consumer tests untouched |
| 🔴 **The data plane was one flat string** — `state.output` was the only inter-node channel, so the expression language routed over structured state the runtime could never produce: `$.input` didn't exist (despite appearing in types.ts doc examples), `$.nodes` didn't exist, `$.output.field` silently resolved `undefined` → false. The routing plane was spec'd; the data plane wasn't (2026-08-12 review, headline finding) | `FlowRunState` wire contract in the spec; runtime channels `input` (write-once) + `nodes` (merge-reduced, parallel-safe) with `FlowStateT extends FlowRunState` compile-time-asserted; fixtures pin `$.input` / `$.nodes.<id>` semantics |
| 🔴 No per-node structured output — gates/edges could only see one opaque string; the runtime scraped JSON ad hoc (`extractPrUrlFromOutput`) | `NodeOutputContract` (`output.kind: 'json'`) — output parsed into `state.nodes[id]`; `OutputParseError` is error-edge routable. Schema enforcement still open (§2, `node-output-schema`) |
| 🔴 No node input mapping — every node implicitly consumed the previous node's output string; multi-input nodes impossible | `TaskStep.input` (Expression or Record) resolved against run state into the effective prompt/stdin/input; runs inside Loop so mappings see per-item state |
| 🟡 Error routing untyped — one catch-all error edge despite a rich AdapterError taxonomy; timeout ≠ rate-limit ≠ parse failure indistinguishable | `ErrorEdge.on` matchers against `NodeExit.errorName`; any number of named edges + ≤1 catch-all; first declared match wins |
| 🟡 Expression language couldn't shape data or distinguish false-from-missing; string routing (\"did the agent say APPROVED\") needed a script hop | `exists` (presence ≠ truthiness), `object`/`array` constructors, `contains`/`startsWith`/`endsWith`/`matches` string ops; `matches` literal patterns validated at load; fixtures extended to 28 incl. `expectedValue` value-semantics pins |
| 🟡 Run-side wire shapes were runtime-private — HITL request/resume payloads, `NodeExit`, `ChangedFile` lived in harness-core, so a reviewer UI had no contract to build against | Moved to flow-spec (`ApprovalRequest`/`ApprovalResume`, `SuspendRequest`, `NodeExit`, `ChangedFile`); harness-core re-exports for compatibility |
| 🟡 Scripts had no credential surface — tools got `ToolAuthRef`, scripts got plain-string env, inviting pasted secrets | `ScriptConfig.secrets` resolved through the CredentialBroker into child env (wins over static env); missing broker / bad id → `AuthError` exit |
| 🔵 Flows had no version identity for durable checkpoints or subflow pins | `FlowDef.version` + `SubflowConfig.version` (pin recorded, not enforced — `subflow-version-pin` report) |
| 🔵 No `test` script in package.json (`pnpm -r test` skipped the contract's own suite) | Added (`vitest run`) |
| 🔴 `loop` + `output.kind: 'json'` was a guaranteed failure on 2+ items — the `\n---\n` join is never valid JSON, so every multi-item json loop exited OutputParseError (post-merge review of the data-plane slice itself) | json-declaring looped nodes aggregate a JSON **array**; `$.nodes.<id>` = per-iteration values; a non-JSON item fails the array parse (correct semantic), pinned by tests |
| 🟡 Scripts couldn't see the data plane — `serializableStateView` predated the new channels, so `HARNESS_STATE_JSON` lacked `input`/`nodes` while docs claimed "full state"; no compile-time tie to `FlowRunState` | `input` included; `nodes` deliberately excluded (env-size — `input` mappings via stdin are the channel); return type is now `Omit<FlowRunState, 'messages'\|'changedFiles'\|'nodes'>` so contract growth forces an explicit decision; docs corrected |
| 🔴 Flow-level output contracts had types and a static check, zero runtime parsing — the factory/fleet seam was toothless | `parseFlowOutput` in the spec (job-intent/job-intents shape checks + min/max, flow-spec re-validated through the catalog validator, structured parse-only); `finalizeOrPause` enforces before 'completed' and records `job.flowOutput`; schema stays honest via `flow-output-schema` report |
| 🔴 The `onUnsupported` list ran on convention; conformance covered 1 of 3 behaviors | `VALIDATION_CASES` + `UNSUPPORTED_CASES` fixtures (JSON-serializable), replayed by spec + runtime with **exact-set** feature match — a stale report after implementing a feature, or a missing report on new dead config, now fails both suites until the fixture changes first |

## 2. Open — package-level (this package's debt)

### 🟡 The export surface is unguarded
`index.ts` wildcard-exports four modules, and harness-core's `catalog.ts` wildcard-exports the package again. Any new symbol becomes public API of two packages with no review point. Cheapest high-leverage fix in the package: curated named exports at both layers.

### 🟡 `AdapterId` bakes two runtime implementations into the wire contract
`'claude-sdk' | 'opencode-cli'` is a closed union in the *spec* package — adding an adapter is a spec change. Everything else in the contract references by id and resolves at runtime (`toolId`, `flowId`); adapters should work the same way (`string` + registry check).

### 🟡 It's a catalog-spec wearing a flow-spec name
`ProductDef`, `ProductRepo`, `ContextSourceDef` (tenancy/git shapes) live here because `validateUnifiedCatalog` needs them. Defensible — but a designer UI importing flow types drags in clone-URL shapes. Rename or split when the designer becomes real.

### 🟡 Runtime seams migrated with the types
`ToolResolver` (`(toolId) => ToolDef | undefined`) is a dispatch signature, not a wire shape — it can't be stored or rendered. Softer versions of the same question: `walkAgents`, `resolveAccepts`. They rode along in the verbatim move; the export-surface curation (above) is the natural moment to decide their home.

### ~~🔴 The `onUnsupported` list runs on convention~~ — resolved 2026-08-12
`UNSUPPORTED_CASES` fixtures with exact-set matching, replayed by spec + runtime (see §1).

### ~~🟡 Conformance covers one of three behaviors~~ — resolved 2026-08-12
All three behaviors now ship as replayable data: `EXPRESSION_CASES` (+`expectedValue`), `VALIDATION_CASES`, `UNSUPPORTED_CASES` (see §1).

### 🟡 Tool nodes have two overlapping input mechanisms
`ToolConfig.args` values were already expression-resolvable; `TaskStep.input` (2026-08-12) now exists on the same node. Both answer "how does state reach this tool?" with different semantics — args merge into the ToolDef template, input rewrites the node's effective `$.output`. The spec doesn't say which to prefer or define their composition. A designer UI will surface this ambiguity immediately; pick a rule (suggest: `input` composes the payload, `args` binds it to the tool's parameters) and document it.

### 🔵 Input delivery is stringly
`input` mappings resolve structured values, then serialize to one string through `state.output`. Right for agents (prompts) and scripts (stdin); wasteful for transform/gate consumers that re-parse what was just serialized. A structured hand-off (an `$.inputView` state slot or executor parameter) is the eventual fix; not urgent.

### 🔵 Wire-format warts locked in 2026-08-12
(a) Input-mapping keys must not be named `kind` — the single-Expression detection heuristic; `{ expr: … } | { map: … }` would have been unambiguous. (b) The write-once `input` reducer treats a legitimately-`null` job input as claimable by a later write; node writes to `input` are prevented by convention only. (c) `nodes` duplicates every output alongside `output` with no truncation policy — irrelevant in-memory, becomes checkpoint-size growth when the durable checkpointer (2.2) lands.

### 🟡 No schema artifact
Controlplane still stores opaque JSONB; Phase 2 would hand-port these rules into Java, and the smithagents seam wants a language-neutral contract. Generated JSON Schema from these types is the agreed answer and doesn't exist yet.

### 🔵 `scanForJsExpressions` can false-positive on inert data
A `literal` whose `value` contains `{kind:'js', expression:'…'}` is reported as a js expression though it's never evaluated. Warning-only today; walking known expression positions (edge conditions, assertions, transform expressions, loop paths, matchers, tool args) would be precise.

### 🔵 Packaging hygiene
~~No `test` script~~ (added 2026-08-12); version 0.0.0/private with no changeset wiring despite semver being a stated extraction motive. Fine today, wrong the day the first out-of-repo consumer appears.

## 3. Open — runtime-level (harness-core's debt, visible through the spec)

These are inherited from the original review; the spec now *warns* about the first row's class, but nothing here executes yet.

| Gap | Severity | Current truth |
|---|---|---|
| `policy` retry/timeout/onError, `joinStrategy`, `terminal:'fail'` | 🔴 | Warned at load, ignored at runtime — authors' reliability config does nothing |
| Parallel fan-out/join | 🔴 | Router follows first sequence edge only; reducers and `joinStrategy` imply otherwise; second+ branches never run (warned) |
| Non-manual triggers | 🟡 | Validated cron/webhook/event/message shapes with no ingress, scheduler, or subscription behind them (warned) |
| Flow-level output contracts | ✅→🟡 | **Enforced 2026-08-12:** `parseFlowOutput` shape-checks job-intent/job-intents (+min/max), re-validates flow-spec emissions, parses structured — and `finalizeOrPause` fails the job on violation, recording `job.flowOutput` on success. Remaining 🟡: schemas (`flow-output-schema`), and nothing *submits* the recorded JobIntent to a JobStateMachine yet — enforcement without emission |
| Node/flow output schema, effect-aware replay | 🟡 | Honestly reported: `output.schema`/`structured.schema` accepted but never validated (`node-output-schema`/`flow-output-schema`); `effect` recorded but not consulted (`effect`) — becomes 🔴 the day a durable checkpointer starts replaying side-effecting nodes (duplicate PRs) |
| Approval `slaMs` / `assigneeRole` | 🔴 | No auto-reject timer; resume route checks only job status — any caller with socket access can approve |
| Durability | 🔴 | `MemorySaver` default checkpointer: restart loses every awaiting-approval/suspended job; durable savers supported but never wired |
| Suspend wake-ups | 🟡 | No timer/event scheduler; resume is entirely the caller's job |
| Loop state semantics | 🟡 | Only last iteration's non-output delta survives; chunked parallelism; no sibling cancellation |
| Subflow v1-light | 🟡 | No agents or interrupt tags inside subflows (compile-time ban — honest, but limits composition) |
| Synthetic interrupt nodes typed as `kind:'agent'` | 🔵 | Type-system lie with cast placeholder configs; future walkers over rewritten flows will trip |
| `changedFiles` only grows | 🔵 | Reverted files stay in the reviewer's diff surface (documented as intentional; still surprising) |
| Legacy coordinator filter | 🔵 | `linearFlowFromAgents` hardcodes skipping ids `coordinator`/`checkout-coordinator` |

## 4. The one-sentence summary

The extraction fixed the *honesty* problem (2026-08-07), the data-plane pass fixed the *capability ceiling*, and the hardening pass turned the alignment mechanisms into enforced tests (three-behavior conformance fixtures) while giving the factory/fleet seam teeth (terminal output enforcement) — what remains is the reliability tier (policy/join/triggers/fan-out still warn-only), schema/effect enforcement, HITL trust (role check, SLA, durable checkpointer), and JobIntent *emission* on top of the now-enforced contract.
