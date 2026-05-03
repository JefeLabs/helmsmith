---
description: Generate the Buttons component page — Button, ButtonGroup, ToggleButton, ToggleButtonGroup, CloseButton.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/buttons.pen` — every button-family variant and state.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Button" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Buttons`** for **{{brand}}**.
> Render Light and Dark sections side by side (skip Dark if `--no-dark`).
> All fills/strokes reference `--accent-*`, `--content-*`, `--surface-*`
> tokens. Component frames named `button`, `button-group`, `toggle-button`,
> `toggle-button-group`, `close-button`.
>
> ### Button (HeroUI v3 — Button.Root)
> Render a matrix:
> - **Variants** (rows): `solid`, `flat`, `outline`, `ghost`, `light`,
>   `shadow`, `link`
> - **Colors** (columns): `default` (neutral), `primary` (accent),
>   `secondary`, `success`, `warning`, `danger`
> - For each cell, render a 3-column micro-strip showing the `md` size in
>   states: `default`, `hover`, `disabled`.
>
> Below the matrix, dedicated rows for:
> - **Sizes** — `xs`, `sm`, `md`, `lg`, `xl` of the primary/solid variant,
>   in default state.
> - **With icon** — leading icon, trailing icon, icon-only (square), all at
>   md/primary/solid. Use lucide `arrow-right` and `plus`.
> - **Loading** — `isLoading` state showing spinner replacing label, both
>   solid/primary and outline/danger.
> - **Disabled** — explicit row showing every variant disabled (opacity
>   reduced, cursor not-allowed annotation).
> - **Full width** — single full-width button at `lg` size.
>
> ### ButtonGroup
> Three rows: horizontal, vertical, segmented (with separator).
> Show two states per row: default and one button selected/active.
> Include a row demonstrating `ButtonGroup.Separator`.
>
> ### ToggleButton & ToggleButtonGroup
> - Single ToggleButton in `off` and `on` states for `solid`, `outline`,
>   `ghost` variants.
> - ToggleButtonGroup `single-select` (radio-like) and `multi-select` (4
>   buttons each).
>
> ### CloseButton
> Three sizes (`sm`, `md`, `lg`) on three surfaces: light, dark, and tinted
> (`--accent-100` light / `--accent-900` dark). Hover state on the right of
> each pair.
>
> ### Spec column
> Right edge of every component group: a 280px-wide spec card listing the
> compound API (`<Button.Root variant="solid" color="primary" size="md">
> <Button.Icon><ArrowRight /></Button.Icon><Button.Label>Continue</Button.Label>
> </Button.Root>`) and the BEM class names (`.button`, `.button__icon`,
> `.button__label`).

## Execution

```bash
pencil --out design/components/buttons.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: full 7×6 matrix present, all five sizes rendered,
loading-state spinner visible, ToggleButtonGroup shows both single- and
multi-select rows.
