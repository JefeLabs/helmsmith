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

## 2. Open — package-level (this package's debt)

### 🟡 The export surface is unguarded
`index.ts` wildcard-exports four modules, and harness-core's `catalog.ts` wildcard-exports the package again. Any new symbol becomes public API of two packages with no review point. Cheapest high-leverage fix in the package: curated named exports at both layers.

### 🟡 `AdapterId` bakes two runtime implementations into the wire contract
`'claude-sdk' | 'opencode-cli'` is a closed union in the *spec* package — adding an adapter is a spec change. Everything else in the contract references by id and resolves at runtime (`toolId`, `flowId`); adapters should work the same way (`string` + registry check).

### 🟡 It's a catalog-spec wearing a flow-spec name
`ProductDef`, `ProductRepo`, `ContextSourceDef` (tenancy/git shapes) live here because `validateUnifiedCatalog` needs them. Defensible — but a designer UI importing flow types drags in clone-URL shapes. Rename or split when the designer becomes real.

### 🟡 Runtime seams migrated with the types
`ToolResolver` (`(toolId) => ToolDef | undefined`) is a dispatch signature, not a wire shape — it can't be stored or rendered. Softer versions of the same question: `walkAgents`, `resolveAccepts`. They rode along in the verbatim move; the export-surface curation (above) is the natural moment to decide their home.

### 🔴 The `onUnsupported` list runs on convention
Nothing ties the report list to what the runtime executes. The README rule ("delete the report in the change that implements the feature") is unenforced — implement `policy.retry` tomorrow and forget the deletion, and every catalog using it warns falsely forever (or worse: the inverse, a new dead field never gets a report). Fix: unsupported-feature fixtures `(flow, expectedFeatures)` replayed by harness-core, like the expression fixtures already are.

### 🟡 Conformance covers one of three behaviors
Expressions have replayable fixtures; **validation verdicts** (valid/invalid catalogs + expected error substrings) and **warning expectations** do not — they're locked in `validate.test.ts` as code, which a Java validator or designer can't replay. The package defines three behaviors; it publishes conformance data for one.

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
| Flow-level output contracts | 🔴 | `job-intent` — the factory/fleet seam — has types and a static check, zero runtime parsing/emission. `structured.schema` never validates anything. (Node-level `output.kind: 'json'` now parses — 2026-08-12 — and is the natural machinery for the terminal-node enforcement, still unbuilt) |
| Node output schema / effect-aware replay | 🟡 | New 2026-08-12 spec surface, honestly reported: `output.schema` accepted but never validated (`node-output-schema`); `effect` recorded but not consulted (`effect`) — becomes 🔴 the day a durable checkpointer starts replaying side-effecting nodes (duplicate PRs) |
| Approval `slaMs` / `assigneeRole` | 🔴 | No auto-reject timer; resume route checks only job status — any caller with socket access can approve |
| Durability | 🔴 | `MemorySaver` default checkpointer: restart loses every awaiting-approval/suspended job; durable savers supported but never wired |
| Suspend wake-ups | 🟡 | No timer/event scheduler; resume is entirely the caller's job |
| Loop state semantics | 🟡 | Only last iteration's non-output delta survives; chunked parallelism; no sibling cancellation |
| Subflow v1-light | 🟡 | No agents or interrupt tags inside subflows (compile-time ban — honest, but limits composition) |
| Synthetic interrupt nodes typed as `kind:'agent'` | 🔵 | Type-system lie with cast placeholder configs; future walkers over rewritten flows will trip |
| `changedFiles` only grows | 🔵 | Reverted files stay in the reviewer's diff surface (documented as intentional; still surprising) |
| Legacy coordinator filter | 🔵 | `linearFlowFromAgents` hardcodes skipping ids `coordinator`/`checkout-coordinator` |

## 4. The one-sentence summary

The extraction fixed the *honesty* problem (2026-08-07) and the data-plane pass fixed the *capability ceiling* (2026-08-12 — run state, node I/O, typed errors, and a data-shaping expression language now exist and execute); what remains is the reliability tier (policy/join/triggers/fan-out still warn-only, schema and effect declared-not-enforced) and the mechanisms keeping spec and runtime aligned (the warning list, the fixture discipline), which are only as strong as the conventions §2 asks to turn into tests.
