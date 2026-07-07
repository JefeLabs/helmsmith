---
description: Generate the z-index foundations page (stacking-order tokens for layered UI). Writes the @theme z-index tokens every overlay component references. Without this, modals stack unpredictably the moment a popover opens over a drawer.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/z-index.pen` and write the z-index tokens
to `@theme`. The token set is small but ordering matters — once
written, components consume the tokens by name (`z-modal`,
`z-tooltip`) instead of inventing magic numbers.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Locate the `@theme` source CSS file.

## Token set written to `@theme`

```css
@theme {
  /* Stacking order — each tier reserves a 10-point band for
     micro-adjustments (e.g. nested popovers). Don't skip tiers. */
  --z-base:        0;     /* normal flow */
  --z-raised:      10;    /* cards lifted off background, pinned headers */
  --z-dropdown:    20;    /* menu / select / combobox dropdowns */
  --z-sticky:      30;    /* sticky headers, sticky table headers */
  --z-overlay:     40;    /* drawer scrims, dropdown backdrops */
  --z-modal:       50;    /* modal dialogs, full-screen sheets */
  --z-popover:     60;    /* popovers anchored to elements (above modals) */
  --z-tooltip:     70;    /* tooltips, last to render in normal flow */
  --z-toast:       80;    /* toast / notification stack */
  --z-debug:       9999;  /* dev overlays, never used in production */
}
```

The order encodes a contract: `tooltip > popover > modal > overlay >
sticky > dropdown > raised > base`. Toast sits highest of the
production tiers because user interactions (e.g. error messages on
failed saves) need to be visible regardless of what else is open.

## Embedded prompt

> Build a Pencil page named **`Foundations / Z-Index`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding.
>
> ### Section 1 — Stacking visualization
>
> A 3D-ish isometric stack showing the 9 tiers (skip `--z-debug` — it's
> not for production). Each tier is a translucent card labeled with:
> - Token name (`--z-toast`, `--z-tooltip`, etc.)
> - Numeric value
> - Use case (`Toast / notification stack`, `Tooltips`, etc.)
>
> Stack from bottom (`--z-base`) to top (`--z-toast`), each tier
> offset diagonally to make the layering legible. Use `--accent` for
> the tier currently being demonstrated and `--content-3` for the rest.
>
> ### Section 2 — Conflict matrix
>
> A small table showing common combinations and which wins:
>
> | Container         | Contained        | Resolution                   |
> | ----------------- | ---------------- | ---------------------------- |
> | Drawer (overlay)  | Popover inside   | Popover wins (60 > 40)       |
> | Modal             | Tooltip          | Tooltip wins (70 > 50)       |
> | Modal             | Toast            | Toast wins (80 > 50)         |
> | Sticky header     | Dropdown opening | Dropdown wins (20 > 30 fail!) |
>
> The last row is intentionally wrong — sticky beats dropdown
> numerically, which is the *bug*. Annotate it with a red callout
> showing the correct reading: dropdowns must use a higher tier than
> the sticky containers they break out of. The `--z-dropdown: 20`
> value assumes dropdowns inside non-sticky containers; sticky
> containers shadowing dropdowns is a known footgun and the
> recommended fix is to portal the dropdown to a higher z-index
> overlay tier.
>
> ### Section 3 — Real-world layering
>
> A single 1200-wide composition showing every tier in use
> simultaneously: a page with sticky header, an open dropdown menu,
> a modal in the foreground with a tooltip on its close button,
> and a toast appearing top-right. Annotate every floating element
> with its z-index token.
>
> ### Naming
> - Token labels reference the CSS variable name
> - Tier blocks: `tier-{{token-name}}`
> - All `z-index` references in demo content use the variable, never
>   raw numbers

## Execution

```bash
pencil --out design/foundations/z-index.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 9 tiers visualized, conflict matrix
present with the correct annotated footgun, real-world composition
shows all tiers simultaneously.

## Component contract

After this foundation is written, every overlay component's
`z-index` must reference these tokens. Inline `z-index: 50` is a
violation — use `z-index: var(--z-modal)`. The Phase 3 lint sweep
extends to flag raw numeric `z-index` in component code.
