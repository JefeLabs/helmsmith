# @helmsmith/flow-spec

The flow wire contract: **types + validation + expression semantics + conformance fixtures**. This package is the spec — the shape stored in controlplane's catalog tables, edited by the (future) flow designer, and executed by harness-core.

The contract covers both halves of a flow: the **definition side** (nodes, edges, tags) and the **data plane** (`FlowRunState` — the run-state shape expressions bind against). Nodes address each other's outputs via `$.nodes.<id>` (structured when a node declares `output.kind: 'json'`), read the job payload via `$.input`, and compose multi-source inputs via `input` mappings; harness-core's state schema is compile-time-asserted against `FlowRunState`, so the two cannot silently drift.

## Hard constraints

- **Browser-safe:** zero runtime dependencies, no `node:*` imports. Anything that touches fs/network/process belongs in harness-core or harness-server.
- **Dependency direction:** harness-core → flow-spec, never the reverse. harness-core re-exports this package from its `catalog.ts`, so downstream consumers (`harness-server`, CLIs) never import flow-spec directly.

## What lives here

| Module | Contents |
|---|---|
| `types.ts` | `FlowDef`, `TaskStep` (incl. `input`/`output`/`effect`), `Edge` (incl. `ErrorEdge.on`), `Expression`, tags/policy/output contracts, `ToolDef`, `JobIntent`, product/catalog shapes, run-side wire shapes (`FlowRunState`, `NodeExit`, `ChangedFile`, `ApprovalRequest`/`ApprovalResume`, `SuspendRequest`), plus the small helpers (`walkAgents`, `resolveAccepts`, `findFlow`, `findProduct`) |
| `validate.ts` | `validateFlowCatalog` / `validateUnifiedCatalog` — fail-loud structural validation with path-prefixed `CatalogError`s, and the unsupported-feature reporting seam |
| `expression.ts` | `evalExpression` / `resolveExpressionValue` / `resolveJsonPath`, typed against structural `unknown` state so a designer preview and the runtime router share one evaluator |
| `fixtures.ts` | `EXPRESSION_CASES` — executable spec data replayed by this package's tests and by harness-core's `flow-spec-conformance.test.ts` |

## What deliberately stays out

- `loadCatalog` (fs read) — harness-core's `catalog.ts`.
- Graph compilation, routing, executors — harness-core's `flow-graph.ts` / `orchestrator.ts`.
- Sharing with smithagents: the factory/fleet seam is work orders, not code. Hand external consumers a schema artifact, not this npm package.

## The `onUnsupported` contract

Both validators accept `{ onUnsupported?: (f: UnsupportedFeature) => void }`. The callback fires for spec features that **validate but are not executed** by the current runtime:

| Feature id | Runtime truth |
|---|---|
| `policy` | retry/timeout/onError are not enforced |
| `joinStrategy` | multiple incoming edges use LangGraph defaults |
| `terminal-fail` | terminal nodes always end the flow as success |
| `trigger-<kind>` | no runtime fires non-manual triggers |
| `expression-js` | the evaluator throws on `js` expressions |
| `parallel-fan-out` | only the first sequence edge from a node is followed |
| `node-output-schema` | `output.kind: 'json'` is parsed into `state.nodes`, but the declared schema is not validated |
| `effect` | classification recorded, not consulted on replay/retry |
| `subflow-version-pin` | version recorded; subflows still resolve by flowId |

Reporting never changes accept/reject behavior. harness-core's `loadCatalog` wires this to one `console.warn` line per finding. **Rule:** when the runtime starts executing a feature, delete its report in the same change — this list is the honest coverage boundary.

## Conformance

`fixtures.ts` is data, not code. Any implementation claiming to support flow expressions (harness-core today; a designer UI or Java-side validator tomorrow — the planned home for generated JSON Schema is this package) must replay `EXPRESSION_CASES` and match `expected`. Change semantics by changing the fixture first; every conforming implementation then fails until it catches up.

## Documentation

| Doc | Contents |
|---|---|
| [`SPEC.md`](./SPEC.md) | Detailed specification — boundary, modules, contract, validation, expressions, conformance |
| [`docs/steps-and-edges.md`](./docs/steps-and-edges.md) | Authoring reference — every step kind, edge, and tag with config tables, JSON examples, and support status |
| [`docs/critical-feedback.md`](./docs/critical-feedback.md) | Consolidated critical feedback with severity and status |
| [`docs/next-steps.md`](./docs/next-steps.md) | Phased roadmap with effort estimates |

Pre-extraction design review of the whole flow runtime: `docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`. Extraction plan: `docs/superpowers/plans/2026-08-07-flow-spec-package.md`.
