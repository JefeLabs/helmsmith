# @helmsmith/flow-designer

## 0.2.1

### Patch Changes

- Updated dependencies [e1987d5]
  - @helmsmith/flow-spec@0.2.0

## 0.2.0

### Minor Changes

- 17dea9e: Theming contract, brand slot, and subflow inline preview for the embeddable `<FlowDesigner>`.

  - **Theming** — the component root now carries a `.flow-designer` class and reads a documented `--flow-*` custom-property contract (canvas, panel, node, border, text, accent, status, and edge tokens). Override them with the new `theme` prop for inline values, or with plain CSS (`.my-theme .flow-designer { --flow-accent: … }`) to inherit a host app's light/dark switch for free.
  - **Brand slot** — new `brand` prop. Defaults to the Helmsmith wordmark for the standalone npx app; pass `null` to render no brand at all, which is what an embed usually wants.
  - **Subflow inline preview** — selecting a `subflow` step now renders the child flow in an inset preview (`data-testid="subflow-inset"`) instead of leaving the delegation opaque.

  Also fixes packaging: `@helmsmith/flow-spec` is now a runtime `dependencies` entry. The emitted `lib.d.ts` re-exports `Catalog`/`FlowDef` from it, so without the package installed a consumer's `Catalog` silently degraded to `any` under `skipLibCheck` — taking exhaustiveness checks over `step.kind` down with it. The bundle still carries its own copy of the validator; the dep exists so the published types resolve, pinned to an exact version so they cannot drift from it.

### Patch Changes

- Updated dependencies
  - @helmsmith/flow-spec@0.1.1
