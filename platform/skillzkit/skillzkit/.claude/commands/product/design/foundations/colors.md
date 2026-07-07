---
description: Generate the color foundations page (semantic palette, ramps, surfaces, light/dark).
argument-hint: [--primary <hex>] [--secondary <hex>] [--warmth cool|neutral|warm]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/colors.pen` — the source of truth for every
color token in the design system.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Load `product/.pencil-brand.json` (or prompt for `primary`, `secondary`,
   `neutralWarmth` if missing / overridden via `$ARGUMENTS`).
3. If MCP available: `get_guidelines({ category: "guide", name: "Color System" })`
   and incorporate any returned guidance into the prompt below.

## Embedded prompt

> Build a single Pencil page named **`Foundations / Colors`** for the
> **{{brand}}** design system. The page must be the canonical reference for
> every color token consumed by Tailwind v4 + HeroUI v3.
>
> Render two top-level sections side by side: **`Light`** (left, on
> `--surface` = #FFFFFF baseline) and **`Dark`** (right, on `--surface` =
> #0A0A0A baseline). Each section is a 1440-wide frame with 64px outer padding
> and 48px between rows.
>
> ### Section 1 — Brand ramps
> For each brand color generate a 50→950 tonal ramp (11 stops). Use
> `{{primary}}` as the **500** stop for `accent`, `{{secondary}}` as the **500**
> stop for `secondary`. Generate the other stops with perceptually uniform
> steps (OKLCH-spaced, not naive HSL lightening). Lay each ramp out as a
> horizontal row of 11 swatches, each 96×96, with rounded `--radius-md`.
> Inside every swatch print the token name (e.g. `--accent-500`) and the hex.
> Mark the canonical `500` stop with a 2px ring in `--content-1`.
>
> Ramps to produce, in order:
> 1. `accent` (HeroUI primary)
> 2. `secondary`
> 3. `tertiary` — derive a complementary hue 30° off accent
> 4. `success` — green family, base `#16A34A` adjusted to {{warmth}}
> 5. `warning` — amber family, base `#D97706`
> 6. `danger`  — red family,   base `#DC2626`
> 7. `neutral` — {{warmth}}-leaning grayscale (cool=blue-tinted, warm=brown-tinted)
>
> ### Section 2 — Semantic surfaces
> Render swatches (240×120) with the token printed inside, in this exact
> order: `--background`, `--surface`, `--surface-raised`, `--surface-overlay`,
> `--content-1`, `--content-2`, `--content-3`, `--separator`, `--focus-ring`,
> `--backdrop`. For Light section, content tokens are dark-on-light. For Dark
> section, invert.
>
> ### Section 3 — Status / state pairings
> For each of `accent`, `success`, `warning`, `danger`, render a 4-up grid
> showing: `default`, `hover` (darker by 1 stop in light, lighter by 1 in
> dark), `subtle background` (50 in light, 900 in dark), and `subtle text`
> (700 in light, 200 in dark). Label each with the exact CSS variable.
>
> ### Section 4 — Accessibility
> Below every ramp, place a contrast strip showing AA / AAA pass/fail badges
> for white text and `--content-1` text on each stop.
>
> ### Naming
> - Frame names use kebab-case: `accent-ramp`, `semantic-surfaces`.
> - Text labels emit token names, not values, except for the small hex caption.
> - All swatches use Pencil variables that map to CSS custom properties — do
>   not hard-code hex on the fill.

## Execution

```bash
pencil --out design/foundations/colors.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

`get_screenshot({ nodeId: "page-root" })` and confirm: 7 ramps × 11 stops
present in both Light and Dark sections, semantic-surfaces row complete,
contrast strips visible. If any ramp is missing stops, refine in place.
