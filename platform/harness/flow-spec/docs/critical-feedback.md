# Flow Spec — Critical Feedback (Consolidated, Current)

**Date:** 2026-08-07 · **Updated:** 2026-08-12 after the data-plane slice (PR #14), the hardening slice (PR #15), a validator-consistency review (PR #17), the export-surface slice (PR #18), the HITL trust slice (PR #19), the policy slice (PR #20), the parallelism slice (PR #21), the schema slice (PR #22), the suspend-wakeup slice (PR #23), the emission slice (PR #24), the terminal-fail slice (PR #25), the trigger-ingress slice (PR #26), the designer slice (PR #27), the adapter-registry slice (PR #28), the loop-v2 slice (PR #29), the message-transport slice (PR #30), and the save-to-server slice · Companion docs: [`SPEC.md`](../SPEC.md) · [`steps-and-edges.md`](./steps-and-edges.md) · [`next-steps.md`](./next-steps.md)

One document, every open criticism, with status. Sources: the pre-extraction design review (`docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`), the package-level critique from `SPEC.md` §7, the semantic findings from documentation-as-audit, the 2026-08-12 data-plane review + its post-merge self-review (plan: `docs/superpowers/plans/2026-08-12-flow-spec-data-plane.md`), and a 2026-08-12 validator-consistency review of the merged package. Items already fixed are listed once in §1 and not re-argued.

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

### 1.4 Validator consistency (2026-08-12, validator-consistency review)

The unifying observation: once the validator crossed into statically-knowable-runtime-failure checking (load-time regex compilation for literal `matches` patterns), unchecked siblings of the same class stopped being scope decisions and became inconsistencies. All four fixed same-day; the three validator rules are pinned by new `VALIDATION_CASES` fixtures replayed by both packages.

| Finding | Resolution |
|---|---|
| 🟡 `jsonpath` path syntax was never checked at load time — a typo like `output` (missing `$.`) or `$.a..b` validated, then silently resolved `undefined` → false at runtime: the exact silent-miss class `exists` was added to escape | Load-time syntax check in `validateExpression`: a path must be `$` or `$.`-prefixed with non-empty segments. Evaluator semantics unchanged — it still resolves any runtime miss to `undefined`, never throws on data |
| 🟡 Shadowed error-edge names validated silently — first-declared-match-wins made a repeated `on` name permanently dead config (the same dead-branch class `parallel-fan-out` warns about), neither rejected nor reported | An error name may appear at most once across a source node's error edges (including within a single `on` list); a duplicate is rejected with a located "can never fire" `CatalogError` |
| 🔵 `job-intents` `min`/`max` were individually validated but never cross-checked — `{ min: 5, max: 2 }` validated yet was unsatisfiable; every terminal output failed `parseFlowOutput`, loudly but only after the flow ran to completion | Load-time `min ≤ max` cross-check in `validateFlowOutputContract` |
| 🔵 `vitest` was missing from devDependencies — the `test` script resolved only via workspace hoisting, so the suite breaks the day the package is extracted (semver/extraction being a stated motive) | `vitest ^4.1.5` declared in the package's own devDependencies |

### 1.5 Export surface + scan precision (2026-08-12, next-steps 0.1 + 0.2)

| Finding | Resolution |
|---|---|
| 🟡 The export surface was unguarded at two layers — `export *` in flow-spec's `index.ts` and again in harness-core's `catalog.ts` re-export meant any new symbol silently became public API of two packages, and both 2026-08-12 slices pushed ~a dozen symbols through it | Curated named exports at both layers; adding a symbol to either list is now the API-review point. The fixture sets stay exported by flow-spec (they ARE the conformance contract) but are deliberately not re-exported by `catalog.ts` — the runtime re-exports the contract, not the test data (the conformance suite imports fixtures from `@helmsmith/flow-spec` directly) |
| 🟡 Runtime seams migrated with the types — `ToolResolver` is a dispatch signature, not a wire shape; it can't be stored or rendered | Moved to harness-core's `tool-executor.ts`, next to its consumer (harness-core's public surface unchanged — `index.ts` re-exports it from there). `walkAgents` / `resolveAccepts` / `findFlow` / `findProduct` stay in the spec deliberately: pure, browser-safe helpers over wire shapes that a designer UI needs as much as the runtime does |
| 🔵 `scanForJsExpressions` false-positived on inert data — a `literal` whose `value` contained a js-shaped object was reported although it is never evaluated | Replaced by a position-aware walk over exactly the positions the runtime evaluates (edge conditions, gate assertions, transform expressions, loop paths, trigger/suspend matchers, input mappings, and top-level tool args / subflow inputs — mirroring the executors' three-kind `isExpression`); literal values are never descended into. Pinned by two new `UNSUPPORTED_CASES` fixtures: inert js-shaped data reports nothing, and js in every live position reports once per occurrence |

### 1.6 HITL trust slice (2026-08-12, roadmap 2.1 + 2.2 + 2.8)

| Finding | Resolution |
|---|---|
| 🔴 Approval `slaMs`/`assigneeRole` unenforced — no auto-reject timer; any caller with socket access could approve anything, forever | Server-side SLA timer per pending approval, armed at pause and re-armed at boot from the ORIGINAL `pausedAt` (expired-while-down fires immediately); auto-reject routes through the same `executeResume` path as the HTTP route. The resume route now validates `decision ∈ {approve, reject}` (400 — malformed bodies used to silently reject) and requires `x-actor-role` == `assigneeRole` (403) — header-asserted identity over the 0600-scoped UDS transport; a real authn source later replaces the header, the enforcement point stays |
| 🔴 Durability — the `MemorySaver` default lost every awaiting-approval/suspended job on restart | SqliteSaver default at `<workspace>/.harness/state/checkpoints.sqlite` (server-side; `RunJobDeps.checkpointer` is the injection seam, PG is a config swap); paused JobRecords + pending requests persist as JSON under `.harness/state/paused/` and rehydrate at boot; `resumeJob` recompiles the graph from `job.flow` on cache miss (recompile-on-resume). Proven by a stop-server-A/boot-server-B integration test |
| 🟡 `effect` recorded but never consulted — the duplicate-PR-on-replay risk that gated the durable checkpointer | `withEffectGuard` (outermost node wrapper): `side-effecting` nodes run at most once — re-entry with completion evidence at `$.nodes.<id>` returns the recorded output. Publish executors are additionally idempotent by natural key (an existing open PR for the head branch is reused; a recorded `mergeSha` short-circuits the merge). Landed BEFORE the durable saver per the roadmap constraint; report deleted fixture-first |

### 1.7 Policy slice (2026-08-12, roadmap 2.3)

| Finding | Resolution |
|---|---|
| 🔴 `policy` retry/timeout/onError validated but ignored — authors' reliability config did nothing (part of the old §3 headline row) | `withPolicy` in the node-wrapper chain (outside `withNodeIO` so retries cover `OutputParseError`, inside `withEffectGuard` so completed side-effecting nodes never re-enter): `retry` = maxAttempts TOTAL attempts with fixed/exponential backoff, error exits only (rejects are authored flow control); `timeout` = per-attempt deadline exiting `errorName: 'Timeout'` (error-edge routable; hung executor detached — no AbortSignal yet); `onError` `'continue'` converts the exhausted error to success, `'fallback'` routes unhandled errors to the fallback edge (in `buildRouter`), `'propagate'` unchanged. Report deleted fixture-first |

### 1.8 Parallelism slice (2026-08-12, roadmap 2.4 — the "decide" resolved as IMPLEMENT)

| Finding | Resolution |
|---|---|
| 🔴 Parallel fan-out/join was the half-state the roadmap called "the worst state" — the router silently followed only the first sequence edge; `joinStrategy` validated and did nothing | Fan-out: every sequence edge fires (LangGraph parallel branches; the legacy `output` channel gained an explicit last-write-wins reducer — concurrent same-superstep writes used to throw `InvalidUpdateError`). Join: an EXPLICITLY declared `joinStrategy` is a barrier over forward-edge sources ('all'/'any'/nOfM, exactly-once per run) via runtime-private `__completions`/`__joinSkips` channels — no wire-contract change. Undeclared multi-in nodes keep trigger-per-arrival semantics (an implicit 'all' would deadlock conditional diamonds — the types.ts "Default 'all'" fiction corrected). Validator rejects exceptional edges targeting joins. v1 caveats documented: joins in reject cycles unsupported; 'all' over a conditionally-skipped source never fires. Both reports (`joinStrategy`, `parallel-fan-out`) deleted fixture-first |

### 1.9 Schema slice (2026-08-12, roadmap 1.2 + 2.7)

| Finding | Resolution |
|---|---|
| 🟡 No schema artifact — controlplane stored opaque JSONB; Phase 2 would hand-port validation rules into Java (the drift machine the original review warned about); the smithagents seam had no language-neutral contract | `schema/flow-spec.schema.json` generated from the types (`pnpm schema`, ts-json-schema-generator as a devDependency — runtime stays zero-dep): 9 wire-shape roots (catalog, flow, jobIntent, runState, HITL payloads, nodeExit, changedFile), 47 $ref'd definitions. Drift-guarded: `schema-artifact.test.ts` regenerates and compares, so a type change that skips regeneration fails CI |
| 🟡 Output schemas accepted but never validated (`node-output-schema`/`flow-output-schema` reports) | The spec owns an enforced JSON-Schema SUBSET (`schema.ts`, browser-safe, zero-dep): `validateSchemaShape` gates declared schemas at catalog load — a keyword outside the subset (e.g. `oneOf`) is rejected, never silently ignored; `schemaViolations` checks parsed output at runtime with located messages. Node violations exit `OutputSchemaViolation` (error-edge routable, retryable) without recording evidence; structured terminal outputs fail the job through `parseFlowOutput`. `SCHEMA_CASES` join the conformance fixtures (four behaviors now); both reports deleted fixture-first |

### 1.10 Suspend-wakeup slice (2026-08-12, roadmap 2.6)

| Finding | Resolution |
|---|---|
| 🟡 Suspend was pause-forever — no timer/event scheduler; resume was entirely the caller's job | Timer suspends arm a server-side wake timer (mirroring the SLA pattern: unref'd, cleared on resume/terminal/stop, re-armed at boot from the original `pausedAt` — expired-while-down fires immediately); event suspends wake through `POST /v1/events`, matching `eventType` and evaluating the declared `matcher` against the event envelope `{ type, payload }` — a binding surface the spec now defines. Wakes flow through `executeResume`, the same path as the HTTP route. The ingress route is the v1 bus seam: a webhook relay or the controlplane posts events; a real bus subscription can replace the transport without touching the matching |

### 1.11 Emission slice (2026-08-12, roadmap 2.9)

| Finding | Resolution |
|---|---|
| 🟡 JobIntent emission — the terminal intent was parsed, enforced, and recorded on `job.flowOutput`, but nothing *submitted* it (enforcement without emission) | `RunJobDeps.onJobIntents` fires from `finalizeOrPause` after the completed transition (single intents as a one-element array; `job-intents` as the full fan-out). harness-server spawns one child job per intent through the same dispatcher path as HTTP submissions (`executeRun`, the extracted shared fire path), with lineage recorded both ways (`parentJobId` / `spawnedJobIds`) and unspawnable intents (unknown flowId, unresolvable accepts set, dispatcher overflow) recorded on `parent.spawnErrors` — the parent stays completed: its own work, emitting a well-formed order, succeeded. Fires from the resume path too, so a job-definition flow that paused at an approval still emits |
| 🔵 Pre-existing dispatcher-slot leak on resumed jobs — paused jobs hold their slot by design, but the resume path never released it at terminal; enough resumed jobs would silently exhaust the dispatcher | `executeResume`'s terminal hook now calls `dispatcherOnJobTerminal` |

### 1.12 Terminal-fail slice (2026-08-13)

| Finding | Resolution |
|---|---|
| 🔴 `terminal: 'fail'` validated and ignored — authored failure endpoints always ended the flow as success (the last warn-only feature from the original review's headline row) | A branch ending at a fail-terminal fails the job: `finalizeOrPause` checks the runtime's completion accounting (deterministic under parallel fan-out; counts the original node id even under interrupt-tag rewrites) and fails with a located bus message; output contracts don't apply to failure endpoints. Validator: a fail marker on a node WITH outgoing edges is rejected (failure endpoints are sinks — dead config with newly surprising semantics otherwise). Report deleted fixture-first |

### 1.13 Trigger-ingress slice (2026-08-13, roadmap 3.1)

| Finding | Resolution |
|---|---|
| 🟡 Non-manual triggers validated with no ingress behind them — cron/webhook/event/message shapes were shapes only | `webhook` fires via `POST\|GET /v1/hooks/<path>` (body/query as the input envelope); `event` fires via the 2.6 `/v1/events` ingress (same `{type, payload}` matcher semantics as suspend wakes — one event can wake suspends AND start flows); `schedule` gets a zero-dep server-local cron engine implementing exactly the subset the validator now gates at load (5 fields; `*`, `*/n`, lists, ranges; standard dom/dow OR-quirk; `tz` REJECTED rather than silently ignored), armed at boot, re-armed per fire, 24h-chunked for long gaps, inspectable via `GET /v1/triggers`. All three spawn through `spawnFlowJob` — the single dispatcher path shared with 2.9 intent spawning — stamping `triggeredBy` provenance. `message` stays validated-and-warned: no transport exists to bind to, and aliasing it onto HTTP would be pretense |

### 1.14 Designer slice (2026-08-13, roadmap 3.2)

| Finding | Resolution |
|---|---|
| 🔵 The package's raison d'être — a browser designer sharing the runtime's exact semantics — existed only as an architecture diagram | `@helmsmith/flow-designer`: standalone Vite/React drag-and-drop editor (React Flow canvas, dagre layout) importing `@helmsmith/flow-spec` directly. Every edit re-runs `validateUnifiedCatalog` live (path-prefixed errors + the 3 remaining warnings); expression and output-schema playgrounds run `evalExpression`/`schemaViolations` verbatim — the designer previews what the router will do, not an approximation. File-based import/export keeps it server-independent; the FlowDef↔canvas mapping is pure and round-trip-tested. v1 boundaries stated in its README (JSON sub-editors, session-only layout, no undo) |

### 1.15 Adapter-registry slice (2026-08-13, roadmap 3.4)

| Finding | Resolution |
|---|---|
| 🟡 `AdapterId` baked two runtime implementations into the wire contract — adding an adapter was a spec change, unlike every other by-id reference (`toolId`, `flowId`) | `AdapterId = string`: the validator checks shape only (non-empty string); existence is enforced at spawn time by the adapter factory — the registry — whose unknown-id error now lists the known adapters and points at `RunJobDeps.adapterFactory` for custom registration. A third adapter is now a runtime-only addition; the spec never changes again for one. (Schema artifact updated: the enum became a string for Java consumers — the drift guard insisted) |

### 1.16 Loop-v2 slice (2026-08-13, roadmap 3.5)

| Finding | Resolution |
|---|---|
| 🟡 Loop state semantics — only the last iteration's non-output delta survived; parallel mode was chunked (a slow item stalled its chunk) with no sibling cancellation; `directory` was non-recursive | Cross-iteration accumulation with per-channel merge semantics (map channels key-merge, append channels concatenate — and a general `withNodeIO` bug fell out: it clobbered any executor's own `nodes` writes with the evidence entry; now spread-merged). Parallel mode is a per-slot sliding-window pool; the first failure aborts an `AbortSignal` now threaded through the `NodeExecutor` contract (optional second param — backward compatible) and stops further launches, with outputs kept in item order. `recursive: true` walks the directory tree, files only (spec addition, fixture-gated). |

### 1.17 Message-transport slice (2026-08-13)

| Finding | Resolution |
|---|---|
| 🔵 `message` triggers validated + warned — no transport existed to bind to | `POST /v1/messages {channel, text, from?}` — the conversational-intake ingress, distinct from `/v1/events` by shape and purpose: the message TEXT becomes the job input directly (the prompt an intake flow feeds its agent), not a JSON envelope. Channel-subscribed flows start with `triggeredBy: message:<channel>`; `GET /v1/triggers` lists channels; one-way in v1 (a Slack/Discord/controlplane relay posts inbound and watches the spawned job). The `trigger-message` report is deleted — the `onUnsupported` list reaches its terminal form: `expression-js` (deliberate) and `subflow-version-pin` |

### 1.18 Save-to-server slice (2026-08-13, designer follow-on)

| Finding | Resolution |
|---|---|
| 🔵 The designer was file-only; the runtime catalog was immutable after boot (edits required a restart) | `GET`/`PUT /v1/catalog` on harness-server: PUT validates with the real validator (400 with the located message, live catalog untouched), persists to the same `.harness/config/flows.json` boot reads (awaited — the response means durable), hot-swaps the live catalog, and re-arms schedule triggers; warnings return in the response; in-flight jobs are unaffected (JobRecord.flow is a submission-time snapshot). The designer gains `server ⇩`/`server ⇧` through a dev proxy (no CORS surface on the harness). Proven end-to-end against a real harness: load → canvas edit → save → live catalog AND flows.json both updated. The endpoint pair is the controlplane seam — same wire shape, different base URL |

### 1.19 Tool input-mechanism rule (2026-08-13)

| Was | Now |
|---|---|
| 🟡 Tool nodes had two overlapping input mechanisms — `ToolConfig.args` values were expression-resolvable and `TaskStep.input` existed on the same node, both answering "how does state reach this tool?" with no stated preference or composition; the designer put the ambiguity in front of authors | The rule the ledger suggested, adopted and enforced: **`input` composes the payload, `args` bind the tool's parameters.** The mechanics already composed this way (`withInputMapping` is the innermost wrapper, so args resolve against post-mapping state — now pinned by a flow-graph test through a real `makeToolExecutor`); the rule is documented on `ToolConfig`/`TaskStep.input` (and therefore in the schema artifact) and in steps-and-edges §2.3. The dead half is now rejected: a ToolDef's templates interpolate against resolved args only, so an `input` mapping on a tool node with no `$.output`-reading arg is provably unobservable — `CatalogError` (`input mapping is dead config`), same class as shadowed error edges. Pinned by three `VALIDATION_CASES` fixtures (dead rejected; `$.output` arg valid; nested `$.output.…` path valid); a `js`-shaped arg conservatively counts as consuming |

### 1.20 Subflow v2 slice (2026-08-13)

| Was | Now |
|---|---|
| 🟡 Subflow v1-light — no agents or interrupt tags inside subflows (compile-time ban; the biggest composition limit left after the roadmap closed) | Both bans lifted. **Agents**: inner flows get executors from the orchestrator's own `makeAgentExecutor` via `SubflowCompileDeps.agentExecutorFactory` — identical adapter-dispatch/fallback/JobRecord pipeline; registration recurses via `walkAgents(flow, resolver)` (spec helper, cycle-guarded, one visit per flow id). **Interrupts**: an interrupt-bearing inner compiles `asSubgraph` (no own checkpointer) and is invoked with the parent node's config (`getConfig()`), so LangGraph namespaces its checkpoints under the parent thread and propagates `GraphInterrupt` natively — the parent invoke surfaces `__interrupt__` with the inner's approval/suspend payload, `Command({resume})` routes to the deepest pending inner, multi-pause and nested-two-level pauses resume in order, and the server's pause/resume/SLA machinery is untouched. The v1 "multi-resume coordinator" fear was unfounded: the framework does it when the checkpointer is shared (verified by spike, then pinned by tests incl. a full runJob→pause→resumeJob round trip where the inner agent does not re-run on resume). Remaining compile-time rejections, both located: loop-tagged subflow node over an interrupt-bearing inner tree (iterations would share one pause namespace); duplicate agent ids across the tree (flat RegisteredAgent lookup). Interrupt-free inners keep the isolated v1 execution path unchanged |

### 1.21 Join-hazard static analysis (2026-08-13)

| Was | Now |
|---|---|
| 🔵 Join hazards under conditional routing — documented, not enforced: an `'all'` join whose counted source is conditionally skipped never fires (the flow ends without it, silently), and joins inside reject cycles are unsupported (the once-per-run marker never resets) | Both wedge classes rejected at load by `validateJoinHazards` (flow-spec validator, so the designer surfaces them live). Under-guaranteed joins: a **must-reach analysis over success routing** computes which sources are guaranteed on every execution path (outcome groups mirror the router — each conditional its own outcome, sequence fan-out as the else, fallback when no sequence, branch-end otherwise); a join whose requirement ('all' = every source, 'any' = 1, nOfM capped at source count) exceeds its guaranteed count is rejected with the skippable sources named. Exhaustive branching that reconverges still validates (the diamond-with-else fixture pins the no-false-positive property); the analysis is deliberately optimistic about joins along the path (nested-join skips can evade — false negatives are the status quo, false positives would reject valid catalogs). Reject-cycle joins: forward-reachable from a reject target AND able to reach its source → rejected. Pinned by five `VALIDATION_CASES` fixtures replayed by both packages |

## 2. Open — package-level (this package's debt)

### 🟡 The name undersells the scope — it's the platform wire-contract package now
Originally: `ProductDef`/`ProductRepo`/`ContextSourceDef` (tenancy/git shapes) live here because `validateUnifiedCatalog` needs them. Since 2026-08-12 the run side (`FlowRunState`, HITL payloads, `NodeExit`, `ChangedFile`) lives here too — deliberately, for the shared-contract reasons in SPEC §3.1.2. Defensible, but a designer UI importing "flow types" now drags in clone-URL shapes and reviewer payloads. Exports are now curated (§1.5), which softens this but doesn't close it — rename or split entry points when the designer becomes real.

### 🔵 Input delivery is stringly
`input` mappings resolve structured values, then serialize to one string through `state.output`. Right for agents (prompts) and scripts (stdin); wasteful for transform/gate consumers that re-parse what was just serialized. A structured hand-off (an `$.inputView` state slot or executor parameter) is the eventual fix; not urgent.

### 🔵 Wire-format warts locked in 2026-08-12
(a) Input-mapping keys must not be named `kind` — the single-Expression detection heuristic; `{ expr: … } | { map: … }` would have been unambiguous. (b) The write-once `input` reducer treats a legitimately-`null` job input as claimable by a later write; node writes to `input` are prevented by convention only. (c) `nodes` duplicates every output alongside `output` with no truncation policy — irrelevant in-memory, becomes checkpoint-size growth when the durable checkpointer (2.2) lands.

### 🔵 Packaging hygiene
Version 0.0.0/private with no changeset wiring despite semver being a stated extraction motive. Fine today, wrong the day the first out-of-repo consumer appears. (The missing `test` script and the hoisting-only `vitest` dependency were both fixed 2026-08-12.)

## 3. Open — runtime-level (harness-core's debt, visible through the spec)

Inherited from the original review, minus what the 2026-08-12 slices closed (terminal output enforcement moved to §1.3). Everything below is warned at load where the spec can see it.

| Gap | Severity | Current truth |
|---|---|---|
| Approval pessimistic locking | 🔵 | `concurrency: 'pessimistic'` validates but no lock exists — two same-role reviewers can race a decision; last write wins via the status guard. (The SLA/role halves of the old approval row were closed by the HITL trust slice — §1.6) |
| Synthetic interrupt nodes typed as `kind:'agent'` | 🔵 | Type-system lie with cast placeholder configs; future walkers over rewritten flows will trip |
| `changedFiles` only grows | 🔵 | Reverted files stay in the reviewer's diff surface (documented as intentional; still surprising) |
| Legacy coordinator filter | 🔵 | `linearFlowFromAgents` hardcodes skipping ids `coordinator`/`checkout-coordinator` |

## 4. The one-sentence summary

The extraction fixed the *honesty* problem (2026-08-07), the data-plane pass fixed the *capability ceiling*, the hardening pass turned the alignment mechanisms into enforced tests (three-behavior conformance fixtures) while giving the factory/fleet seam teeth (terminal output enforcement), the validator-consistency + export-surface passes closed the statically-knowable-failure gaps and made both export layers curated review points, the HITL trust slice made approval production-grade (SLA auto-reject, role-gated resume, durable checkpointer with restart rehydration, effect-aware replay), the policy slice made retry/timeout/onError real, the parallelism slice made fan-out + joinStrategy barriers real, the schema slice enforced output schemas (owned subset) and shipped the generated contract artifact, the suspend-wakeup slice made suspend a real durability primitive, the emission slice closed the factory/fleet loop (enforced work orders now spawn their work jobs), the terminal-fail slice made authored failure endpoints real, the trigger-ingress + message-transport slices made every trigger kind fire, the Phase 3 slices delivered the designer, the adapter registry, and Loop v2, the tool input-mechanism rule made the two input channels compose by definition (`input` composes the payload, `args` bind the parameters — the dead combination now rejected), the subflow v2 slice lifted the last composition limit (agents and approval/suspend now work inside subflows, pauses propagating through the parent's checkpointer), and the join-hazard analysis turned the 2.4 caveats into load-time rejections (under-guaranteed joins and reject-cycle joins can no longer wedge silently) — the roadmap is complete, and the warn-list is at its terminal form (`expression-js` by design; `subflow-version-pin`).
