---
description: Generate the grid & layout foundations page (breakpoints, columns, gutters, containers).
argument-hint: [--columns 12|16] [--max-width <px>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/grids.pen` — the responsive grid system every
template and layout depends on.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Default to a 12-column grid unless `--columns 16` is passed.

## Embedded prompt

> Build a Pencil page named **`Foundations / Grids`** for the **{{brand}}**
> design system.
>
> ### Section 1 — Breakpoint reference table
> A reference card listing every breakpoint, its query, container max-width,
> column count, and gutter width. Use Tailwind v4's defaults:
>
> | Token | Min width | Container max | Cols | Gutter | Margin |
> | ----- | --------- | ------------- | ---- | ------ | ------ |
> | xs    | 0         | 100% fluid    | 4    | 16     | 16     |
> | sm    | 640       | 640           | 6    | 16     | 24     |
> | md    | 768       | 768           | 8    | 24     | 24     |
> | lg    | 1024      | 1024          | 12   | 24     | 32     |
> | xl    | 1280      | 1280          | 12   | 32     | 48     |
> | 2xl   | 1440      | 1440          | 12   | 32     | 64     |
> | 3xl   | 1920      | 1536          | 12   | 32     | 64     |
>
> Token names: `--bp-xs`, `--container-xs`, `--col-count-xs`, `--gutter-xs`,
> `--margin-xs`, etc.
>
> ### Section 2 — Visual grid overlays
> Render four device frames stacked vertically, each containing a column
> overlay with semi-transparent `--accent-500 @ 12%` columns and visible
> gutters:
>
> 1. **Mobile** — 390px-wide frame, 4-col, 16px gutter, 16px margin
> 2. **Tablet** — 768px-wide frame, 8-col, 24px gutter, 24px margin
> 3. **Desktop** — 1280px-wide frame, 12-col, 32px gutter, 48px margin
> 4. **Wide** — 1920px-wide frame, 12-col centered in 1536 container, 32px gutter
>
> Label each frame with the breakpoint token, viewport width, and column
> count. Add a "safe area" callout on the mobile frame showing iOS notch +
> home indicator clearance (47px top, 34px bottom).
>
> ### Section 3 — Container patterns
> Four stacked examples showing common layouts at desktop:
> - **Full bleed** (edge-to-edge media)
> - **Container** (centered, max-width xl)
> - **Container with sidebar** (3-col sidebar + 9-col content)
> - **Two-pane** (4-col + 8-col)
>
> Each is annotated with the column span syntax (`col-span-{n}` Tailwind v4)
> and the corresponding HeroUI Surface naming.
>
> ### Section 4 — Spacing rhythm
> A vertical rhythm reference: stacked content blocks at 8px baseline grid,
> labeled with `space-y-{n}` Tailwind classes. Demonstrates 8 / 16 / 24 / 48
> as the canonical block-spacing rhythm.

## Execution

```bash
pencil --out design/foundations/grids.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Confirm each device frame shows its column overlay correctly —
mobile must have 4 cols, desktop 12. If a column count is wrong, the
breakpoint logic was applied to the wrong frame; refine in place pointing
out which frame is off.
