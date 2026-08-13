# @helmsmith/flow-spec — Specification & Critical Notes

**Package:** `platform/harness/flow-spec` · **Version:** 0.0.0 (private, source-shipped) · **Date:** 2026-08-07 · **Updated:** 2026-08-12 (data-plane contract: run state, node I/O, error matchers, expression additions; validator-consistency pass: load-time path syntax, error-edge shadow rejection, min ≤ max; export-surface slice: curated exports at both layers, position-aware js scan) · **Landed via:** PR #13 (`feat/flow-spec-package`)

This document is the detailed companion to the package `README.md`: the full contract the package defines and the exact semantics its code implements. Critique and roadmap live in dedicated docs (see §7 for the map). The pre-extraction critique of the whole flow *runtime* lives in `docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`; runtime findings are only summarized here, not repeated.

---

## 1. Purpose and boundary

`@helmsmith/flow-spec` is the **flow wire contract as code**: the types stored in controlplane's catalog tables, the validator that accepts or rejects a catalog, the expression evaluator whose answers routing decisions depend on, and the conformance fixtures that pin those answers down. It exists so three consumers can share one definition without sharing a runtime:

```mermaid
flowchart LR
    spec["@helmsmith/flow-spec<br/>types · validate · expression · fixtures<br/>zero deps, browser-safe"]
    core["harness-core<br/>compileFlow, executors, loadCatalog"]
    designer["flow designer UI<br/>(@helmsmith/flow-designer)"]
    cp["controlplane Phase 2<br/>(via schema/flow-spec.schema.json)"]
    core -->|"depends on + re-exports"| spec
    designer -.->|"imports directly"| spec
    cp -.->|"consumes schema artifact"| spec
```

Two hard rules define the boundary:

1. **Browser-safe:** zero runtime dependencies, no `node:*` imports. `loadCatalog` (fs) stayed behind in harness-core for exactly this reason.
2. **Dependency direction:** harness-core → flow-spec, never back. The evaluator was retyped from LangGraph's `FlowStateT` to structural `unknown` before the split because this rule makes reaching back for runtime types impossible afterward.

Deliberately **not** here: graph compilation, routing, executors (harness-core); catalog loading (harness-core); runtime dispatch seams — function types that can't be stored or rendered, e.g. `ToolResolver`, which lives in harness-core's `tool-executor.ts`; anything shared with smithagents — the factory/fleet seam is work orders, not code, so external consumers get a schema artifact, never this npm package.

## 2. Module map

| Module | Exports | Role |
|---|---|---|
| `types.ts` (~1000 lines) | `FlowDef`, `TaskStep` (incl. `input`/`output`/`effect`), `NodeOutputContract`, `Edge` (incl. `ErrorEdge.on`), `Expression`, tags, policy, `FlowOutputContract`, `JobIntent`, `ToolDef` family, `ProductDef`/`ProductRepo`/`ContextSourceDef`, `FlowCatalog`/`Catalog`, `CatalogError`, run-side wire shapes (`FlowRunState`, `NodeExit`, `ChangedFile`, `ApprovalRequest`/`ApprovalResume`, `SuspendRequest`), `walkAgents`, `resolveAccepts`, `findFlow`, `findProduct` | The wire shapes — definition side AND run side |
| `validate.ts` | `validateFlowCatalog`, `validateUnifiedCatalog`, `ValidateOptions`, `UnsupportedFeature` | Fail-loud structural validation + the unsupported-feature reporting seam |
| `expression.ts` | `evalExpression`, `resolveExpressionValue`, `resolveJsonPath` | Expression semantics, shared verbatim by the runtime router and any future designer preview |
| `output.ts` | `parseFlowOutput`, `FlowOutputParseResult` | Terminal output-contract enforcement (job-intent/job-intents shape + min/max, flow-spec re-validation, structured parse); the runtime's `finalizeOrPause` fails jobs through this |
| `fixtures.ts` | `ExpressionCase`/`EXPRESSION_CASES` (28 cases, `expectedValue` pins value semantics), `ValidationCase`/`VALIDATION_CASES`, `UnsupportedCase`/`UNSUPPORTED_CASES` — all JSON-serializability guarded | Executable spec data for all three behaviors; replayed by this package's tests and harness-core's `flow-spec-conformance.test.ts` |
| `schema.ts` | `validateSchemaShape`, `schemaViolations` | The enforced JSON-Schema subset — load-time keyword gate + runtime violation check (2.7) |
| `schema/flow-spec.schema.json` | generated artifact (`pnpm schema`) | Language-neutral contract for Java/other consumers; drift-guarded by `schema-artifact.test.ts` (1.2) |
| `index.ts` | curated named exports of all six modules | Public surface — adding a symbol to the list IS the API-review point (harness-core's `catalog.ts` re-export is curated the same way, minus the fixture sets) |

## 3. The contract in detail

### 3.1 One primitive, edges route, tags modify

A flow is a graph of `TaskStep` nodes — one polymorphic primitive discriminated by `kind` — plus typed edges that carry **all** routing logic. There are deliberately no `if` / `loop` / `try` / `fork` / `map` step kinds. Terminal nodes are nodes with no outgoing edges.

| `kind` | Config | Purpose |
|---|---|---|
| `trigger` | `manual` \| `webhook` \| `schedule` \| `event` \| `message` | Entry marker; exactly one per flow. Ingress-backed (3.1): `webhook` fires via `POST\|GET /v1/hooks/<path>`, `event` via `POST /v1/events` (matcher against `{type, payload}`), `schedule` via a server-local cron scheduler (subset grammar, load-time validated; `tz` rejected). `message` via `POST /v1/messages` (conversational intake — the text becomes the job input) |
| `agent` | `AgentDef` — adapter, prompt, `accepts` model bindings (flat or named sets), `fallbackOn`, `skillz` | LLM work; the dominant kind |
| `tool` | `toolId` + expression-resolvable `args`, resolved to a `CliToolDef` \| `HttpToolDef` \| `McpToolDef` | Deterministic call |
| `script` | `bash` \| `node` \| `python` + inline `source` + `secrets` (broker-resolved env credentials) | Batch subprocess, state via stdin + env |
| `transform` | one `Expression` | Pure data shaping into `state.output` |
| `gate` | `assertions[]` (expression + message) | All pass → success; any fail → reject with payload |
| `subflow` | `flowId` + optional `input` | Composed inner flow (deterministic-only in v1) |
| `publish` | `push-and-open-pr` \| `merge-pr` | Ship the work as a PR |

Edge types and the routing precedence the runtime implements (spec'd here so a designer can preview it):

```mermaid
flowchart TD
    exit["node exit"] --> r{"reject exit +<br/>reject edge?"}
    r -- "attempts < max (default 3)" --> cycle["cycle back<br/>(only edge type allowed to)"]
    r -- "max reached" --> esc["escalate target, or fail"]
    r -- no --> e{"error exit?"}
    e -- "error edge" --> et["error target"]
    e -- "no edge" --> die["flow fails"]
    e -- no --> c["conditional edges,<br/>declaration order, first match"]
    c -- none --> s["sequence edges (ALL fire — parallel fan-out)"]
    s -- none --> f["fallback edge"]
    f -- none --> END
```

Structural rules the validator enforces: exactly one trigger (no incoming, ≥1 outgoing); ≤1 each of fallback/reject edges per source; error edges — any number carrying `on` matchers plus ≤1 catch-all (no/empty `on`), routed by `NodeExit.errorName` (first declared match wins, catch-all last), and each error name may appear at most once across a source's error edges (a shadowed name could never fire, so it is rejected); reject edges only from `gate` or approval-tagged nodes; reject-edge `onMaxAttempts.escalate` targets must exist; everything except reject edges must form a DAG.

### 3.1.1 Node I/O — the data plane

Every `TaskStep` may declare `input`, `output`, and `effect`:

- **`input`** (executed): an Expression or a Record of name → Expression, resolved against `FlowRunState` into the node's *effective input* — the prompt for agents, stdin for scripts, `$.output` for everything else. This replaces the implicit "previous node's output string" contract when a node needs more than one upstream value. The single-Expression form is detected by a string `kind` field, so mapping keys must not be named `kind`. Runs inside the Loop wrapper (a looped node's mapping sees the per-item state).
- **`output`** (`NodeOutputContract`, executed): `{ kind: 'json' }` parses the node's output string into `state.nodes[id]`; invalid JSON → `errorName: 'OutputParseError'` (error-edge routable). `schema` is enforced (2.7): load-time gated to the spec's JSON-Schema subset (`schema.ts` — unsupported keywords rejected, never silently ignored), runtime-checked against the parsed value — violations → `errorName: 'OutputSchemaViolation'`, and the value is not recorded as evidence. Omitted/`text` → the raw string is recorded.
- **`effect`** (executed): `'pure' | 'idempotent' | 'side-effecting'` — replay/retry safety classification. The runtime consults it on node re-entry: a `side-effecting` node with completion evidence in `$.nodes.<id>` is skipped (at-most-once), returning its recorded output; `idempotent`/`pure`/unset re-run freely. Authors who want re-publish semantics mark publish nodes `idempotent` and rely on the executor's natural-key idempotency.

### 3.1.2 The run-state contract

`FlowRunState` is the wire shape expressions bind against — the data plane made explicit: `input` (job payload, write-once), `nodes` (per-node outputs keyed by id, merge-reduced so parallel branches can't clobber), `output` (legacy latest-string channel), plus routing bookkeeping (`lastExit`, `rejectionPayload`, `attempts`) and operator surfaces (`steering`, `changedFiles`, `cancelRequested`). harness-core's `FlowStateT` is compile-time-asserted to satisfy it (`flow-graph.ts`), so a channel rename or type drift stops the build. The HITL payloads (`ApprovalRequest`/`ApprovalResume`, `SuspendRequest`) and `ChangedFile` live here too — a reviewer UI and the runtime must agree on them for the same reason a designer preview and the router must agree on expressions.

### 3.2 Tags and policy

`tags.approval` (HITL gate: `assigneeRole`, `slaMs`, steering inputs) and `tags.suspend` (timer/event pause) are mutually exclusive; `tags.loop` (collection/directory source, sequential/parallel mode) composes with either. `policy` is **executed** (2026-08-12): `retry` re-runs an error-exiting node up to `maxAttempts` TOTAL attempts with fixed/exponential backoff (retries also cover `OutputParseError`; reject exits are authored flow control and never retried); `timeout` is a per-attempt deadline exiting `errorName: 'Timeout'` (error-edge routable); `onError` `'continue'` converts an exhausted error to success, `'fallback'` routes an unhandled error to the node's fallback edge, `'propagate'` (default) fails the flow as before. `joinStrategy` is **executed** (2026-08-12): a node that explicitly declares it becomes a barrier over its forward-edge (sequence/conditional) sources — `all` waits for every source, `any` fires on the first arrival, `nOfM` on the nth — exactly once per run; undeclared multi-in nodes keep trigger-per-arrival semantics (an implicit `all` would deadlock diamonds whose branches route conditionally). The validator rejects exceptional (error/fallback/reject) edges targeting a join node. v1 caveats: joins inside reject cycles are unsupported, and an `all` join over a conditionally-skipped source never fires. `terminal: 'fail'` is **executed** (2026-08-13): a branch ending at a fail-terminal fails the whole job (deterministic under parallel fan-out via the runtime's completion accounting; output contracts don't apply to failure endpoints), and the validator rejects a fail marker on a node with outgoing edges — failure endpoints are sinks.

### 3.3 Expression language — semantics, including the sharp edges

Tagged union: `literal`, `jsonpath`, `compare`, `all`, `any`, `not`, `js`. The evaluator in `expression.ts` is the single source of truth; `EXPRESSION_CASES` pins 17 behaviors. The table below documents what the code **actually does**, including three behaviors discovered by documentation-as-audit and since pinned (record in `docs/critical-feedback.md` §1):

| Construct | Semantics |
|---|---|
| `literal` | `Boolean(value)` as predicate; raw value via `resolveExpressionValue` |
| `jsonpath` | Dot-path only: `$`, `$.a.b`. Missing/non-object intermediate → `undefined`, never throws. Dot-numeric array indexing (`$.arr.0`) is **supported and pinned by fixture**; out-of-bounds → `undefined`. No bracket syntax, wildcards, or filters. Malformed paths (no `$` prefix, empty segments) are rejected by the validator at load time — the evaluator itself still resolves any runtime miss to `undefined` |
| `compare ==` / `!=` | Strict `===`/`!==`. No coercion: `"5" == 5` is false. Objects compare by **reference** — two structurally equal objects from jsonpath are never `==` (pinned by fixture) |
| `compare <` `<=` `>` `>=` | Both sides through `Number()`; NaN on either side ⇒ false (both `NaN < 5` and `NaN >= 5` are false) |
| `compare in` | rhs must resolve to an array, else false (no substring semantics — that's `contains`). Membership via `Array.includes` — **SameValueZero, not strict equality**: `NaN` self-matches (reachable only from runtime state; JSON can't encode NaN — pinned by code-level test, kept out of fixtures so they stay JSON-serializable) |
| `compare contains` / `startsWith` / `endsWith` | String-only: both sides must resolve to strings, else false — no coercion, mirroring `in`'s strictness (pinned by fixtures) |
| `compare matches` | Both sides strings; `new RegExp(rhs).test(lhs)`, no flags. Invalid pattern from state ⇒ false (the evaluator never throws on data — pinned by code-level test); invalid **literal** patterns are rejected at load time by the validator |
| `all` / `any` | Short-circuit AND/OR; `all([])` ⇒ true, `any([])` ⇒ false (identity elements) |
| `not` | Predicate inversion |
| `exists` | Presence, not truthiness: false only for `undefined` (missing path); `null`/`false`/`0`/`""` all exist (pinned by fixtures) — the escape hatch from the silent-`undefined` jsonpath semantics |
| `object` / `array` | Constructors: fields/items resolved via `resolveExpressionValue`; always true as predicates (containers are truthy). The data-shaping half of the language — with these, `transform` + `output.kind: 'json'` builds structured `$.nodes.<id>` values |
| `js` | **Throws.** Deliberate: no sandbox dependency; compose the boolean primitives instead |
| composition as value | `compare`/`all`/`any`/`not`/`exists` under `resolveExpressionValue` collapse to their boolean — no surprising polymorphism |

### 3.4 Flow kinds and output contracts

`FlowDef.kind` ∈ `work` (default) | `job-definition` | `post-job`. A `job-definition` flow must declare `output: { kind: 'job-intent' }` (statically enforced) and emit a `JobIntent` — the factory/fleet work-order seam. `FlowOutputContract` also admits `agent-text`, `job-intents` (min/max fan-out), `flow-spec`, `structured` (schema required). **Runtime enforcement exists** (2026-08-12): `parseFlowOutput` runs at the terminal — job-intent(s) are shape-checked (+min/max), flow-spec emissions are re-validated through the catalog validator, structured output must parse as JSON and conform to its declared subset schema (2.7); violation fails the job, success records `job.flowOutput`. Emission is real (2.9): completed `job-intent`/`job-intents` flows fire `RunJobDeps.onJobIntents` and harness-server submits one child job per intent through its dispatcher, recording lineage (`parentJobId`/`spawnedJobIds`) and per-intent spawn errors.

### 3.5 Catalog and product shapes

`FlowCatalog` (`flows[]`) and `Catalog` (adds `products?[]` — `ProductDef` with `contextSources` and `repos`). Products are admin-owned tenancy shapes; they ride along in this package because the unified catalog validator needs them (see §7.2 for whether they belong).

## 4. Validation

`validateFlowCatalog` / `validateUnifiedCatalog` are assert-style, throwing `CatalogError` with path-prefixed messages (`test: flows[0].nodes[2].config.toolId must be …`). Coverage: catalog shape, per-flow kind/output rules + `version` (incl. `job-intents` min ≤ max), per-node kind + per-kind config shape (incl. script `secrets`, subflow `version`), node `input` mappings, `output` contracts, `effect` enum, tags (approval/suspend exclusivity, loop shape), policy/joinStrategy/terminal shapes, per-edge shape + referential integrity + cardinality (incl. error-edge `on` lists, the one-catch-all rule, and shadowed-error-name rejection) + reject-source restrictions, trigger constraints (incl. cron subset syntax + tz rejection), join-node incoming-edge restrictions (forward edges only), fail-terminal sink rule (no outgoing edges), DAG check, duplicate ids (flows, nodes, agents, products, repos), `accepts` forms, `fallbackOn` against the closed AdapterError name set, `skillz` key set, load-time regex compilation for literal `matches` patterns, load-time jsonpath path-syntax checks.

Validation is **structural only** — it answers "is this shaped like a flow?", never "will this flow do what it says?" The second question is exactly what §5 exists for.

## 5. The unsupported-feature contract

```mermaid
sequenceDiagram
    participant A as Catalog author
    participant V as validateFlowCatalog
    participant L as loadCatalog (harness-core)
    A->>V: catalog + { onUnsupported }
    V->>V: structural validation (throws on bad shape)
    V-->>L: one callback per validated-but-unexecuted feature
    L->>A: console.warn "[catalog] …: 'terminal-fail' is not executed by the runtime yet — …"
```

`ValidateOptions.onUnsupported` fires for: `expression-js` (position-aware scan of exactly the expression positions the runtime evaluates — js-shaped data in a literal's `value` or in non-resolved tool args is inert and not reported), `subflow-version-pin` (recorded, resolution by flowId). Reporting never changes accept/reject behavior; no callback ≡ pre-extraction semantics. Deliberately NOT reported because they execute: node `input` mappings, `output.kind: 'json'` parsing, error-edge `on` matchers, script `secrets`, the new expression kinds, terminal output-contract parsing, `effect` (side-effecting nodes are skipped on re-entry when completion evidence exists), `policy` (retry/backoff, per-attempt timeout, onError — §3.2), parallel fan-out (every sequence edge fires) and `joinStrategy` barriers (§3.2), output schemas — node `output.schema` and `structured.schema` are load-time subset-gated and runtime-enforced (`schema.ts`, 2.7) — `terminal: 'fail'` (authored failure endpoints, §3.2), and schedule/webhook/event triggers (server ingress, 3.1).

**The list is test-enforced, not convention-enforced** (2026-08-12): `UNSUPPORTED_CASES` fixtures pin the exact report set per flow, replayed by both this package and harness-core — implementing a feature without deleting its report (or adding dead config without a report) fails conformance until the fixture changes first.

**The governing rule** (from the README): when the runtime starts executing a feature, its report is deleted *in the same change*. The report list is the honest coverage boundary between spec and runtime.

## 6. Conformance

Conformance data now covers all four behaviors the package defines, as plain JSON-serializable data replayed by two suites (`fixtures.test.ts` here; `flow-spec-conformance.test.ts` in harness-core) — a future designer preview or Java validator conforms the same way:

- `EXPRESSION_CASES` — `{ name, expr, state, expected, expectedValue? }`: `expected` pins the predicate coercion; `expectedValue` (when present) pins `resolveExpressionValue` deep-equality (constructor and raw-lookup value semantics).
- `VALIDATION_CASES` — `{ name, catalog, valid, errorIncludes? }`: accept/reject verdicts plus error-location substrings.
- `UNSUPPORTED_CASES` — `{ name, flow, expectedFeatures }`: EXACT sorted-set match on reported feature ids (stale and missing reports both fail).
- `SCHEMA_CASES` — `{ name, schema, value, valid, violationIncludes? }`: output-schema subset semantics (schemaViolations verdicts + located messages).

Semantics change by changing the fixture first; every conforming implementation fails until it catches up.

---

## 7. Critique and roadmap — moved to dedicated docs

Each concern now has exactly one home (this section previously held both and is kept as a map):

| Concern | Document |
|---|---|
| Authoring reference — every step kind, edge, tag, with config tables, JSON examples, and support status | [`docs/steps-and-edges.md`](./docs/steps-and-edges.md) |
| Critical feedback — consolidated, severity-rated, with resolved-item record | [`docs/critical-feedback.md`](./docs/critical-feedback.md) |
| Suggested next steps — phased roadmap with effort estimates and sequencing | [`docs/next-steps.md`](./docs/next-steps.md) |

Headline status as of 2026-08-12 (post-schema-slice): the extraction fixed the *honesty* problem; the data-plane pass fixed the *capability ceiling*; the hardening pass made the alignment *test-enforced*; the validator-consistency and export-surface passes closed the statically-knowable gaps and curated both export layers; the HITL trust slice made approval production-grade; the policy slice made `retry`/`timeout`/`onError` real; the parallelism slice made fan-out + `joinStrategy` barriers real; the schema slice enforced output schemas (owned JSON-Schema subset) and shipped the generated `schema/flow-spec.schema.json` artifact for non-TypeScript consumers; the suspend-wakeup slice made suspend self-waking (timers + event ingress); and the emission slice closed the factory/fleet loop (enforced intents spawn their work jobs with two-way lineage). The roadmap is complete. The report list is at its terminal form: `expression-js` (a design position — compose the boolean primitives, no JS sandbox) and `subflow-version-pin`.
