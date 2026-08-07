# @helmsmith/flow-spec — Specification & Critical Notes

**Package:** `platform/harness/flow-spec` · **Version:** 0.0.0 (private, source-shipped) · **Date:** 2026-08-07 · **Landed via:** PR #13 (`feat/flow-spec-package`)

This document is the detailed companion to the package `README.md`: the full contract the package defines and the exact semantics its code implements. Critique and roadmap live in dedicated docs (see §7 for the map). The pre-extraction critique of the whole flow *runtime* lives in `docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`; runtime findings are only summarized here, not repeated.

---

## 1. Purpose and boundary

`@helmsmith/flow-spec` is the **flow wire contract as code**: the types stored in controlplane's catalog tables, the validator that accepts or rejects a catalog, the expression evaluator whose answers routing decisions depend on, and the conformance fixtures that pin those answers down. It exists so three consumers can share one definition without sharing a runtime:

```mermaid
flowchart LR
    spec["@helmsmith/flow-spec<br/>types · validate · expression · fixtures<br/>zero deps, browser-safe"]
    core["harness-core<br/>compileFlow, executors, loadCatalog"]
    designer["flow designer UI<br/>(future, browser)"]
    cp["controlplane Phase 2<br/>(future, via generated schema)"]
    core -->|"depends on + re-exports"| spec
    designer -.->|"imports directly"| spec
    cp -.->|"consumes schema artifact"| spec
```

Two hard rules define the boundary:

1. **Browser-safe:** zero runtime dependencies, no `node:*` imports. `loadCatalog` (fs) stayed behind in harness-core for exactly this reason.
2. **Dependency direction:** harness-core → flow-spec, never back. The evaluator was retyped from LangGraph's `FlowStateT` to structural `unknown` before the split because this rule makes reaching back for runtime types impossible afterward.

Deliberately **not** here: graph compilation, routing, executors (harness-core); catalog loading (harness-core); anything shared with smithagents — the factory/fleet seam is work orders, not code, so external consumers get a schema artifact, never this npm package.

## 2. Module map

| Module | Exports | Role |
|---|---|---|
| `types.ts` (~790 lines) | `FlowDef`, `TaskStep`, `Edge`, `Expression`, tags, policy, `FlowOutputContract`, `JobIntent`, `ToolDef` family, `ProductDef`/`ProductRepo`/`ContextSourceDef`, `FlowCatalog`/`Catalog`, `CatalogError`, `walkAgents`, `resolveAccepts`, `findFlow`, `findProduct` | The wire shapes, moved verbatim from harness-core's `catalog.ts` |
| `validate.ts` | `validateFlowCatalog`, `validateUnifiedCatalog`, `ValidateOptions`, `UnsupportedFeature` | Fail-loud structural validation + the unsupported-feature reporting seam |
| `expression.ts` | `evalExpression`, `resolveExpressionValue`, `resolveJsonPath` | Expression semantics, shared verbatim by the runtime router and any future designer preview |
| `fixtures.ts` | `ExpressionCase`, `EXPRESSION_CASES` (17 cases, JSON-serializability guarded) | Executable spec data; replayed by this package's tests and harness-core's `flow-spec-conformance.test.ts` |
| `index.ts` | wildcard re-export of all four | Public surface (see `docs/critical-feedback.md` §2 for why "wildcard" is a critique) |

## 3. The contract in detail

### 3.1 One primitive, edges route, tags modify

A flow is a graph of `TaskStep` nodes — one polymorphic primitive discriminated by `kind` — plus typed edges that carry **all** routing logic. There are deliberately no `if` / `loop` / `try` / `fork` / `map` step kinds. Terminal nodes are nodes with no outgoing edges.

| `kind` | Config | Purpose |
|---|---|---|
| `trigger` | `manual` \| `webhook` \| `schedule` \| `event` \| `message` | Entry marker; exactly one per flow |
| `agent` | `AgentDef` — adapter, prompt, `accepts` model bindings (flat or named sets), `fallbackOn`, `skillz` | LLM work; the dominant kind |
| `tool` | `toolId` + expression-resolvable `args`, resolved to a `CliToolDef` \| `HttpToolDef` \| `McpToolDef` | Deterministic call |
| `script` | `bash` \| `node` \| `python` + inline `source` | Batch subprocess, state via stdin + env |
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
    c -- none --> s["sequence edge (first only)"]
    s -- none --> f["fallback edge"]
    f -- none --> END
```

Structural rules the validator enforces: exactly one trigger (no incoming, ≥1 outgoing); ≤1 each of error/fallback/reject edges per source; reject edges only from `gate` or approval-tagged nodes; reject-edge `onMaxAttempts.escalate` targets must exist; everything except reject edges must form a DAG.

### 3.2 Tags and policy

`tags.approval` (HITL gate: `assigneeRole`, `slaMs`, steering inputs) and `tags.suspend` (timer/event pause) are mutually exclusive; `tags.loop` (collection/directory source, sequential/parallel mode) composes with either. `policy` (retry/backoff/timeout/onError), `joinStrategy` (`all`/`any`/`nOfM`), and `terminal: 'fail'` are **part of the wire contract but not executed by the runtime** — they validate, then report through `onUnsupported` (§5).

### 3.3 Expression language — semantics, including the sharp edges

Tagged union: `literal`, `jsonpath`, `compare`, `all`, `any`, `not`, `js`. The evaluator in `expression.ts` is the single source of truth; `EXPRESSION_CASES` pins 17 behaviors. The table below documents what the code **actually does**, including three behaviors discovered by documentation-as-audit and since pinned (record in `docs/critical-feedback.md` §1):

| Construct | Semantics |
|---|---|
| `literal` | `Boolean(value)` as predicate; raw value via `resolveExpressionValue` |
| `jsonpath` | Dot-path only: `$`, `$.a.b`. Missing/non-object intermediate → `undefined`, never throws. Dot-numeric array indexing (`$.arr.0`) is **supported and pinned by fixture**; out-of-bounds → `undefined`. No bracket syntax, wildcards, or filters |
| `compare ==` / `!=` | Strict `===`/`!==`. No coercion: `"5" == 5` is false. Objects compare by **reference** — two structurally equal objects from jsonpath are never `==` (pinned by fixture) |
| `compare <` `<=` `>` `>=` | Both sides through `Number()`; NaN on either side ⇒ false (both `NaN < 5` and `NaN >= 5` are false) |
| `compare in` | rhs must resolve to an array, else false (no substring semantics). Membership via `Array.includes` — **SameValueZero, not strict equality**: `NaN` self-matches (reachable only from runtime state; JSON can't encode NaN — pinned by code-level test, kept out of fixtures so they stay JSON-serializable) |
| `all` / `any` | Short-circuit AND/OR; `all([])` ⇒ true, `any([])` ⇒ false (identity elements) |
| `not` | Predicate inversion |
| `js` | **Throws.** Deliberate: no sandbox dependency; compose the boolean primitives instead |
| composition as value | `compare`/`all`/`any`/`not` under `resolveExpressionValue` collapse to their boolean — no surprising polymorphism |

### 3.4 Flow kinds and output contracts

`FlowDef.kind` ∈ `work` (default) | `job-definition` | `post-job`. A `job-definition` flow must declare `output: { kind: 'job-intent' }` (statically enforced) and emit a `JobIntent` — the factory/fleet work-order seam. `FlowOutputContract` also admits `agent-text`, `job-intents` (min/max fan-out), `flow-spec`, `structured` (schema required). Runtime enforcement of the contract against terminal-node output does not exist yet (inherited gap, §7.5).

### 3.5 Catalog and product shapes

`FlowCatalog` (`flows[]`) and `Catalog` (adds `products?[]` — `ProductDef` with `contextSources` and `repos`). Products are admin-owned tenancy shapes; they ride along in this package because the unified catalog validator needs them (see §7.2 for whether they belong).

## 4. Validation

`validateFlowCatalog` / `validateUnifiedCatalog` are assert-style, throwing `CatalogError` with path-prefixed messages (`test: flows[0].nodes[2].config.toolId must be …`). Coverage: catalog shape, per-flow kind/output rules, per-node kind + per-kind config shape, tags (approval/suspend exclusivity, loop shape), policy/joinStrategy/terminal shapes, per-edge shape + referential integrity + cardinality + reject-source restrictions, trigger constraints, DAG check, duplicate ids (flows, nodes, agents, products, repos), `accepts` forms, `fallbackOn` against the closed AdapterError name set, `skillz` key set.

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
    L->>A: console.warn "[catalog] …: 'policy' is not executed by the runtime yet — …"
```

`ValidateOptions.onUnsupported` fires for: `policy`, `joinStrategy`, `terminal-fail`, `trigger-<kind>` (non-manual), `expression-js` (recursive scan of the whole flow), `parallel-fan-out` (second+ sequence edge from one node — the runtime router silently follows only the first). Reporting never changes accept/reject behavior; no callback ≡ pre-extraction semantics.

**The governing rule** (from the README): when the runtime starts executing a feature, its report is deleted *in the same change*. The report list is the honest coverage boundary between spec and runtime.

## 6. Conformance

`EXPRESSION_CASES` is plain data — `{ name, expr, state, expected }` — so conformance is a replay, not an import of behavior. Today two suites replay it: `fixtures.test.ts` (the spec testing itself) and harness-core's `flow-spec-conformance.test.ts` (the runtime proving its re-exported evaluator matches). A future designer preview or Java validator conforms the same way. Semantics change by changing the fixture first; every conforming implementation fails until it catches up.

---

## 7. Critique and roadmap — moved to dedicated docs

Each concern now has exactly one home (this section previously held both and is kept as a map):

| Concern | Document |
|---|---|
| Authoring reference — every step kind, edge, tag, with config tables, JSON examples, and support status | [`docs/steps-and-edges.md`](./docs/steps-and-edges.md) |
| Critical feedback — consolidated, severity-rated, with resolved-item record | [`docs/critical-feedback.md`](./docs/critical-feedback.md) |
| Suggested next steps — phased roadmap with effort estimates and sequencing | [`docs/next-steps.md`](./docs/next-steps.md) |

Headline status as of 2026-08-07: the extraction fixed the *honesty* problem (dangling spec, silent dead config, unpinned semantics — all resolved, see critical-feedback §1); the *capability* gap remains (policy/joinStrategy/terminal/triggers/fan-out warn but don't execute), and two convention-only mechanisms — the `onUnsupported` list and the export surface — are the top candidates to turn into enforced tests and curated API (next-steps Phase 0–1).
