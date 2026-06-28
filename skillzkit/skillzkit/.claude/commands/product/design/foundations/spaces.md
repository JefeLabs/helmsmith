---
description: Generate the spacing foundations page (spacing scale, radius scale, elevation, motion).
argument-hint: [--radius sharp|sm|md|lg|rounded]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/spaces.pen` — spacing, radius, elevation, and
motion tokens. These four often live together because they're the small
numeric tokens that touch every component.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Load `product/.pencil-brand.json` for `radiusScale`.

## Embedded prompt

> Build a Pencil page named **`Foundations / Spaces`** for the **{{brand}}**
> design system. Page is a 1440-wide canvas, 64px padding.
>
> ### Section 1 — Spacing scale
> Tailwind v4 default scale: `0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8,
> 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72,
> 80, 96`. For each step, render a horizontal bar of width = token value × 4
> (Tailwind's 1 unit = 0.25rem = 4px), filled `--accent-500`, with the token
> label `space-{n}` and pixel value to the right. Group into three columns
> for compact display.
>
> ### Section 2 — Radius scale
> Render seven 96×96 squares filled `--surface-raised` with these radii
> (driven by `{{radiusScale}}`):
>
> | Token         | sharp | sm  | md  | lg   | rounded |
> | ------------- | ----- | --- | --- | ---- | ------- |
> | --radius-xs   | 0     | 2   | 4   | 6    | 8       |
> | --radius-sm   | 0     | 4   | 6   | 8    | 12      |
> | --radius-md   | 2     | 6   | 8   | 12   | 16      |
> | --radius-lg   | 4     | 8   | 12  | 16   | 24      |
> | --radius-xl   | 6     | 12  | 16  | 24   | 32      |
> | --radius-2xl  | 8     | 16  | 24  | 32   | 48      |
> | --radius-full | 9999  | 9999| 9999| 9999 | 9999    |
>
> Use the column matching `{{radiusScale}}`. Label each square with both the
> token name and the pixel value.
>
> ### Section 3 — Elevation / shadow
> Six 240×120 cards on `--background`, each with `--surface-raised` fill,
> demonstrating the shadow scale `--shadow-1` through `--shadow-6` plus an
> `--shadow-inner`. Place them in a 4×2 grid. Label each with the token and
> a one-word use case (`flat`, `subtle`, `card`, `popover`, `dialog`,
> `dragged`).
>
> ### Section 4 — Border weights
> Four 240×120 cards demonstrating `--border-thin` (1px), `--border-medium`
> (1.5px), `--border-thick` (2px), `--border-focus` (2px ring + 2px offset).
>
> ### Section 5 — Motion tokens
> A reference card listing duration and easing tokens used by HeroUI v3:
>
> | Token              | Value  | Use                            |
> | ------------------ | ------ | ------------------------------ |
> | --duration-instant | 75ms   | Color/opacity micro-changes    |
> | --duration-fast    | 150ms  | Hover / focus                  |
> | --duration-base    | 200ms  | Default UI transition          |
> | --duration-slow    | 300ms  | Layout shift / drawer / modal  |
> | --duration-slower  | 500ms  | Page-level transition          |
> | --ease-out         | cubic-bezier(0.16, 1, 0.3, 1)   |
> | --ease-in-out      | cubic-bezier(0.65, 0, 0.35, 1)  |
> | --ease-spring      | spring(stiffness=300, damping=30) |
>
> Render the durations as four animated bars (Pencil supports prototype
> connections — if available, attach a hover trigger that animates each bar
> at its respective duration).
>
> ### Section 6 — Z-index layers
> A vertical stack diagram of standard z layers: `base (0)`, `raised (10)`,
> `dropdown (1000)`, `sticky (1100)`, `fixed (1200)`, `popover (1300)`,
> `overlay (1400)`, `modal (1500)`, `toast (1600)`, `tooltip (1700)`. Label
> each layer with its token name `--z-<layer>`.

## Execution

```bash
pencil --out design/foundations/spaces.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Every section must be present and labeled. The radius column
matching `{{radiusScale}}` must be the only one rendered (not all five).
