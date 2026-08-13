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
- **File-based** — import a `flows.json`, export the edited catalog.
- **Layout persistence** — hand-arranged node positions persist per flow id in browser localStorage and re-apply on reload, flow switch, import, and server load (steps without a stored position get the dagre spot; `relayout` recomputes everything, and the recomputed layout persists like any other arrangement). FlowDef stays layout-free: the exported/saved wire shape is byte-identical.
- **Save-to-server** — `server ⇩` / `server ⇧` load and save the catalog of a **running harness** via `GET`/`PUT /v1/catalog`: the server validates with the real validator (rejections surface the path-prefixed message in the toolbar), persists to the same `.harness/config/flows.json` boot reads, hot-swaps its live catalog, and re-arms schedule triggers — edits go live without a restart. Start the harness with a TCP listener and point the dev proxy at it: `HARNESS_URL=http://127.0.0.1:<tcpPort> pnpm dev`. The endpoint pair is the controlplane seam: a Spring catalog service implementing the same wire shape (defined by `schema/flow-spec.schema.json`) is just a different proxy target.

## v1 boundaries (deliberate)

- Layout lives in this browser's localStorage keyed by flow id — it does not travel with the exported catalog or across machines (a shareable sidecar file could come later; flows with the same id share a layout slot).
- Structured sub-objects edit as JSON, not bespoke visual builders — the `JsonField` seam replaces one field at a time later.
- Undo/redo covers graph edits (⌘Z / ⌘⇧Z, toolbar ↶↷): semantic actions and whole drags are single history entries; selection churn and no-op field applies record nothing; native text-undo inside fields is untouched. History is per-flow-session — switching flows or importing resets it.
