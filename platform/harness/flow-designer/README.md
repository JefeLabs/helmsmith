# @helmsmith/flow-designer

Visual editor for flow catalogs — the browser consumer `@helmsmith/flow-spec` was built for. Drag-and-drop canvas (React Flow) over the wire contract, with the **exact** validator, expression evaluator, and schema checker the runtime uses running live on every edit.

```
pnpm dev        # http://localhost:5175
pnpm test       # graph↔flow mapping round-trip tests
pnpm build      # typecheck + production bundle
```

## Use it

**Standalone** (any harness or controlplane serving the `/v1/catalog` wire shape):

```
npx @helmsmith/flow-designer --harness http://127.0.0.1:8787
```

Binds loopback by default (the proxy forwards approval actor headers — network exposure is `--host 0.0.0.0`, an explicit decision).

**Embedded in a React app** (react/react-dom are the only peers; React Flow, dagre, flow-spec, and the compiled styles are bundled):

```tsx
import { FlowDesigner } from '@helmsmith/flow-designer';
import '@helmsmith/flow-designer/styles.css';

<div style={{ height: '100vh' }}>
  <FlowDesigner
    initialCatalog={catalog}
    onCatalogChange={(live) => save(live)}
    serverBase={null /* or a proxy path to your harness */}
  />
</div>;
```

The component fills its container; `onCatalogChange` fires with the live catalog after every edit; `serverBase: null` hides the server buttons for file-only embedding.

## What it does

- **Canvas editing** — all 8 step kinds from the palette; edges drawn by handle-drag (default `sequence`, retyped in the panel to conditional/error/fallback/reject with per-type fields); node/edge deletion; dagre auto-layout (`relayout`).
- **Property panel** — id renames cascade to edges; per-kind `config`, `input`, `output`, `tags`, `policy`, `joinStrategy` edited as validated JSON (a parse failure shows inline and never corrupts the flow); `effect`/`terminal` as selects.
- **Tag builder** — `loop` (source/mode, path as an expression tree, concurrency, recursive), and a single **pause slot** for approval ⊥ suspend (the validator's exclusivity rule made unrepresentable): approval edits role/SLA/steering-input rows; suspend edits its wake trigger — timer duration, or event type + matcher via the expression builder. Empty tags prune to an absent field.
- **Input-mapping & trigger builders** — `input` mappings edit as named-field rows (or one single expression; the form toggle is lossless — a field map IS an object-constructor expression), with the `kind` key and collisions guarded; trigger config edits as kind select + per-kind fields, with event matchers using the full expression builder against the `{ type, payload }` envelope.
- **Visual expression builder** — conditional-edge conditions, transform expressions, and gate assertions edit as a recursive tree (kind select + per-kind fields, add/remove clauses); switching kinds is non-destructive (wrap into `not`/`exists` and back out, `all`↔`any` keep clauses, `compare` adopts the current expression as `lhs`); a `{ } json` toggle per field keeps the raw editor available. Builder edits ride the same apply channel as JSON edits, so undo/redo and live validation cover them.
- **Live honesty** — every change re-runs `validateUnifiedCatalog`: path-prefixed errors and the unsupported-feature warnings appear instantly; the toolbar lamp is green/amber/red.
- **Playgrounds** — expression evaluation (`evalExpression` + `resolveExpressionValue`) and output-schema checking (`schemaViolations`) against editable sample state, running the same code the router routes with.
- **File-based** — import a `flows.json`, export the edited catalog.
- **Layout persistence** — hand-arranged node positions persist per flow id in browser localStorage and re-apply on reload, flow switch, import, and server load (steps without a stored position get the dagre spot; `relayout` recomputes everything, and the recomputed layout persists like any other arrangement). FlowDef stays layout-free: the exported/saved wire shape is byte-identical.
- **Shareable layout sidecar** — arrangements now travel: `export` writes `flows.layout.json` beside `flows.json` (skipped when nothing is arranged); `import` detects a layout file by shape and re-arranges the canvas (undoable); `server ⇧`/`server ⇩` carry the layout through `GET`/`PUT /v1/catalog/layout` (stored beside `flows.json` on the harness, per-flow replace merge). All best-effort: a server without the route, a network failure, or a bad file never blocks the catalog operation it rides with.
- **Save-to-server** — `server ⇩` / `server ⇧` load and save the catalog of a **running harness** via `GET`/`PUT /v1/catalog`: the server validates with the real validator (rejections surface the path-prefixed message in the toolbar), persists to the same `.harness/config/flows.json` boot reads, hot-swaps its live catalog, and re-arms schedule triggers — edits go live without a restart. Start the harness with a TCP listener and point the dev proxy at it: `HARNESS_URL=http://127.0.0.1:<tcpPort> pnpm dev`. The endpoint pair is the controlplane seam — and the Spring controlplane now implements it: point the proxy at the controlplane (`HARNESS_URL=http://127.0.0.1:8080 pnpm dev`) and `server ⇩`/`server ⇧` read and write org-scoped flows in Postgres, with PUT bodies gated against the generated `schema/flow-spec.schema.json` (semantic validation still runs at harness load — the schema gate is shape-only, so the designer's live TS validation remains the richer surface).

## Theming

Every color the designer paints comes from a `--flow-*` CSS custom property declared on the component root (`.flow-designer`) with the chart-room palette as defaults — no hardcoded colors inside. Override any subset from plain CSS:

```css
.my-theme .flow-designer {
  --flow-accent: #7c3aed;
  --flow-canvas-bg: #f8fafc;
}
```

or pass the `theme` prop (same properties, set inline on the root — handy for JS-driven theme switching):

```tsx
<FlowDesigner theme={{ '--flow-accent': '#7c3aed' }} />
```

The contract (see `src/styles.css` for defaults):

| Group | Tokens |
|---|---|
| Surfaces | `--flow-app-bg`, `--flow-canvas-bg`, `--flow-canvas-glow`, `--flow-panel-bg`, `--flow-panel-raised-bg`, `--flow-node-bg-deep`, `--flow-subflow-inset-bg`, `--flow-shadow` |
| Lines & text | `--flow-border`, `--flow-border-soft`, `--flow-text`, `--flow-text-dim`, `--flow-text-faint` |
| Accent & status | `--flow-accent`, `--flow-accent-soft`, `--flow-accent-glow`, `--flow-error`, `--flow-warn`, `--flow-ok` |
| Step kinds | `--flow-kind-trigger`, `--flow-kind-agent`, `--flow-kind-tool`, `--flow-kind-script`, `--flow-kind-transform`, `--flow-kind-gate`, `--flow-kind-subflow`, `--flow-kind-publish` |
| Edge kinds | `--flow-edge-sequence`, `--flow-edge-conditional`, `--flow-edge-error`, `--flow-edge-fallback`, `--flow-edge-reject` |

The toolbar wordmark is a slot too: `brand` accepts any ReactNode and defaults to the Helmsmith wordmark; pass `brand={null}` to render no brand at all (white-label embeds).

## Subflow preview

Selecting a `subflow` step reveals the actual child flow — resolved by `flowId` against the live catalog — in a translucent read-only inset under the canvas (`--flow-subflow-inset-bg` carries the alpha). Deselect and it goes away. The inset's `open <id> →` button jumps through: the child becomes the active flow with full editing on the same surface (the flows sidebar is the way back). Version-pinned targets note that the pin is recorded but resolution stays by flowId; an id with no match in the catalog explains itself instead of rendering nothing (and offers no jump). One nesting level: the preview never previews its own subflows.

## v1 boundaries (deliberate)

- Layout is keyed by flow id (flows with the same id share a layout slot) and the server-side store is per-workspace, not per-user — two people arranging the same flow differently will trade arrangements on save/load.
- Undo/redo covers graph edits (⌘Z / ⌘⇧Z, toolbar ↶↷): semantic actions and whole drags are single history entries; selection churn and no-op field applies record nothing; native text-undo inside fields is untouched. History is per-flow-session — switching flows or importing resets it.
