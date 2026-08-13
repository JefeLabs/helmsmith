# @helmsmith/flow-designer

Visual editor for flow catalogs — the browser consumer `@helmsmith/flow-spec` was built for. Drag-and-drop canvas (React Flow) over the wire contract, with the **exact** validator, expression evaluator, and schema checker the runtime uses running live on every edit.

```
pnpm dev        # http://localhost:5175
pnpm test       # graph↔flow mapping round-trip tests
pnpm build      # typecheck + production bundle
```

## What it does

- **Canvas editing** — all 8 step kinds from the palette; edges drawn by handle-drag (default `sequence`, retyped in the panel to conditional/error/fallback/reject with per-type fields); node/edge deletion; dagre auto-layout (`relayout`).
- **Property panel** — id renames cascade to edges; per-kind `config`, `input`, `output`, `tags`, `policy`, `joinStrategy` edited as validated JSON (a parse failure shows inline and never corrupts the flow); `effect`/`terminal` as selects.
- **Live honesty** — every change re-runs `validateUnifiedCatalog`: path-prefixed errors and the unsupported-feature warnings appear instantly; the toolbar lamp is green/amber/red.
- **Playgrounds** — expression evaluation (`evalExpression` + `resolveExpressionValue`) and output-schema checking (`schemaViolations`) against editable sample state, running the same code the router routes with.
- **File-based** — import a `flows.json`, export the edited catalog. Deliberately server-independent: a save-to-controlplane path can be added without touching the editor core.

## v1 boundaries (deliberate)

- Node positions are session-only (FlowDef carries no layout — a sidecar layout file is a later addition; `relayout` recomputes).
- Structured sub-objects edit as JSON, not bespoke visual builders — the `JsonField` seam replaces one field at a time later.
- No undo/redo yet; export early, export often.
