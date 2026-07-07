---
description: Generate the density foundations page (compact / comfortable / spacious modes as coordinated token sets). Establishes density as a system-level concern — not just smaller padding, but a synchronized adjustment of spacing, typography line-height, control sizes, and table row heights. Critical for data-heavy products.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/density.pen` and write the density token
sets to `@theme`. Density isn't padding-shrink — it's a coordinated
adjustment of multiple dimensions that together produce a coherent
"compact" vs "comfortable" vs "spacious" feel. Without this
foundation, density toggles half-work: padding shrinks but line-heights
don't, fonts get tight but controls stay tall.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Locate the `@theme` source CSS file.

## Density model

Three modes, each defining a multiplier set applied across spacing,
typography, control heights, and table rows:

| Token              | compact | comfortable | spacious |
| ------------------ | ------- | ----------- | -------- |
| Spacing multiplier | 0.75×   | 1.00× (default) | 1.25× |
| Line-height bump   | -0.15   | 0           | +0.15    |
| Control min-height | 32px    | 40px        | 48px     |
| Table row height   | 36px    | 48px        | 60px     |
| Card padding       | 12/16px | 16/24px     | 24/32px  |
| Form field gap     | 12px    | 16px        | 24px     |

`comfortable` is the system default — it equals the existing token
values from `spaces.md` etc. Compact and spacious adjust from there.

## Token set written to `@theme`

```css
@theme {
  /* Default = comfortable. Override per-context via [data-density="…"] */
  --density-spacing-multiplier:    1;
  --density-line-height-offset:    0;
  --density-control-min-height:    40px;
  --density-table-row-height:      48px;
  --density-card-padding-y:        16px;
  --density-card-padding-x:        24px;
  --density-form-gap:              16px;
}

[data-density="compact"] {
  --density-spacing-multiplier:    0.75;
  --density-line-height-offset:    -0.15;
  --density-control-min-height:    32px;
  --density-table-row-height:      36px;
  --density-card-padding-y:        12px;
  --density-card-padding-x:        16px;
  --density-form-gap:              12px;
}

[data-density="spacious"] {
  --density-spacing-multiplier:    1.25;
  --density-line-height-offset:    0.15;
  --density-control-min-height:    48px;
  --density-table-row-height:      60px;
  --density-card-padding-y:        24px;
  --density-card-padding-x:        32px;
  --density-form-gap:              24px;
}
```

The `data-density` attribute is set at the **scope** that needs it —
typically `<body>` for app-wide density, but can also be set on a
single page or section (e.g. a data-heavy table region in compact
mode while the surrounding page stays comfortable).

## Embedded prompt

> Build a Pencil page named **`Foundations / Density`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between sections.
>
> ### Section 1 — Side-by-side density comparison
>
> Three columns rendering identical content under different density
> modes:
>
> - Column A: `compact` (1280px / 3 = ~410px wide)
> - Column B: `comfortable` (default, ~410px wide)
> - Column C: `spacious` (~410px wide)
>
> Each column shows:
> 1. **Form**: label + text-input + select + button (vertical stack
>    showing the form-gap difference)
> 2. **Table**: 5 rows × 4 columns (showing row-height difference)
> 3. **Card**: title + body + footer (showing padding difference)
> 4. **Stat row**: 3 stat cards (showing spacing-multiplier across
>    cards)
>
> Annotate each density mode column at the top with the mode label
> and `data-density="…"` attribute string.
>
> ### Section 2 — Use case mapping
>
> A small reference table:
>
> | Use case                               | Recommended density |
> | -------------------------------------- | ------------------- |
> | Marketing pages, landing               | spacious            |
> | Product pages, dashboards (default)    | comfortable         |
> | Settings, account, onboarding          | comfortable         |
> | Data tables, log views, admin panels  | compact             |
> | Scheduling / calendar grids            | compact             |
> | Mobile (any context)                   | comfortable (touch targets) |
>
> ### Section 3 — Per-region density (mixed mode)
>
> A composition showing one page using two density modes
> simultaneously: comfortable in the page header + nav, compact in
> a data table within the page body. Annotate the boundary where
> `data-density="compact"` is applied.
>
> This pattern matters for products like **sports / scheduling platforms** where a
> dashboard page mixes scheduling data tables (which want compact)
> with summary cards above (which want comfortable).
>
> ### Section 4 — Touch-target compliance under compact
>
> A callout: even in `compact` mode, control min-height is 32px
> which is BELOW the WCAG AAA 44×44 touch target. On touch devices
> (`@media (pointer: coarse)`), compact mode should be overridden:
>
> ```css
> @media (pointer: coarse) {
>   [data-density="compact"] {
>     --density-control-min-height: 44px;
>     --density-table-row-height:   44px;
>   }
> }
> ```
>
> Render this rule in a code block and explain: compact mode is for
> mouse + keyboard contexts; touch contexts always meet AAA targets
> regardless of density preference.
>
> ### Naming
> - Section frames: `density-comparison`, `use-case-mapping`,
>   `mixed-mode`, `touch-compliance`
> - Per-mode columns: `density-{{mode}}`
> - Per-component demos: `demo-{{component}}-{{mode}}`

## Execution

```bash
pencil --out design/foundations/density.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm:
- Three columns of identical content rendered in three densities
- All four content patterns (form / table / card / stat row) present
  in each column
- Use-case mapping table complete
- Mixed-mode composition shows the per-region density boundary
- Touch-compliance callout with the `pointer: coarse` override

## Component contract

Components that have density-sensitive properties read from these
tokens:

```tsx
// ✅ Density-aware via tokens
<button className="h-density-control-min-height px-density-card-padding-x">

// ❌ Hard-coded — ignores density mode
<button className="h-10 px-6">
```

The token utilities (`h-density-control-min-height`,
`p-density-card-padding-x`, etc.) are auto-generated by Tailwind v4
from the `@theme` declarations.

## Migration note for existing components

When this foundation is added to an existing project, components
already using fixed token values (`h-10`, `p-4`) continue to work —
they just become density-insensitive. Migrating a component to be
density-aware is a per-component decision; not every component needs
to participate in density toggling. A **dashboard table** definitely
should; a **brand logo** doesn't.
