---
description: Generate the Color System component page — ColorPicker, ColorArea, ColorSlider, ColorField, ColorSwatch, ColorSwatchPicker.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/color-system.pen` — HeroUI v3's color-input
components (the new in v3 family).

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "ColorPicker" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Color System`** for **{{brand}}**.
> Light + Dark.
>
> ### ColorArea (2D saturation/value picker rectangle)
> Render three variants:
> - HSV (hue fixed, picking saturation × value)
> - HSL (lightness fixed)
> - HSB
> Each at sizes `sm (160)`, `md (240)`, `lg (320)`. Show the thumb
> indicator at three positions per size (corner, center, edge) to
> demonstrate placement.
>
> ### ColorSlider
> - Hue slider (0–360 rainbow) horizontal at three widths
> - Hue slider vertical
> - Saturation slider (per a fixed hue)
> - Lightness slider
> - Alpha slider with checkerboard background
> Each in `sm`, `md`, `lg` thicknesses. Show thumb in default, hover, focus,
> disabled states.
>
> ### ColorPicker (compound: trigger + popover with Area + Sliders + Swatches + Field)
> Render the closed states (a button-like trigger showing the current color
> swatch + hex) in 4 variants: `default`, `compact` (square swatch only),
> `with hex label`, `with eyedropper button`.
> Render the open popover composition once at full size — Area + Hue slider
> + Alpha slider + Hex/RGB/HSL ColorField tabs + Swatches grid below.
>
> ### ColorField (text input that accepts hex / rgb / hsl strings)
> A row of inputs:
> - Hex format with # prefix slot
> - RGB format
> - HSL format
> - States: `default`, `focus`, `invalid` (bad hex), `with leading swatch`
>   (live preview chip in the prefix slot)
>
> ### ColorSwatch (single read-only color tile)
> Sizes: `xs (16)`, `sm (24)`, `md (32)`, `lg (48)`, `xl (64)`.
> Shapes: `square`, `rounded` (`--radius-sm`), `circle`.
> States: `default`, `selected` (with check icon overlay), `disabled`,
> `transparent` (checkerboard).
> With border outline (when swatch is white/very light).
> With label below showing token reference.
>
> ### ColorSwatchPicker (selectable swatch grid)
> Three patterns:
> - **Brand palette** — single-row of the 7 status semantic tokens
> - **Tonal ramp** — single ramp (e.g. accent 50–950) with selected stop
> - **Material grid** — 8×11 grid of brand ramps (selectable, with
>   focus-ring on hovered cell)
> - **With "more" trigger** — ends with a `+` button that opens a full
>   ColorPicker popover
>
> ### Composition example
> Bottom of page — a "Theme customization" panel showing how a user picks
> their accent color: ColorSwatchPicker for preset, then ColorPicker for
> custom, then a live-preview Surface showing a Button + Input + Card with
> the picked color applied.

## Execution

```bash
pencil --out design/components/color-system.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: ColorArea thumb visible in every variant, all five
ColorSlider types present, ColorPicker open popover shows full
Area+Slider+Field+Swatches composition.
