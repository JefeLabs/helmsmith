---
description: Generate the Surfaces component page — Surface, Separator, Accordion, Disclosure, DisclosureGroup, ScrollShadow.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
produces:
  - design/components/surfaces.pen
---

Generate `design/components/surfaces.pen` — the structural layout primitives.
This page should be generated **first** (or near-first) in the components
group because every other component composes on top of Surface.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Surface" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Surfaces`** for **{{brand}}**.
> Light + Dark side by side.
>
> ### Surface (the foundational background container)
> Surface is HeroUI v3's primitive that resolves color tokens contextually
> (a Surface inside another Surface knows its depth). Render the depth
> ladder:
>
> 1. **Background** (`--background`) — the page itself, full-bleed
> 2. **Surface** (`--surface`) — main content area, e.g. card on background
> 3. **Surface raised** (`--surface-raised`) — popover/dropdown depth
> 4. **Surface overlay** (`--surface-overlay`) — modal depth
>
> Render this as a nested-rectangle "russian doll" diagram showing all four
> depths stacked, each labeled with its token. Repeat once for Light section
> and once for Dark.
>
> ### Surface variants
> - `default` (no border)
> - `bordered` (1px `--separator`)
> - `elevated` (with `--shadow-2`)
> - `flat` (just fill, no chrome)
> - `tinted` — accent / success / warning / danger tints (subtle)
>
> A 4-column grid of Surface cards demonstrating each variant.
>
> ### Separator
> Variants:
> - **Horizontal** — `solid`, `dashed`, `dotted` weights. With label
>   ("OR" centered between sections).
> - **Vertical** — between two adjacent components (e.g. between two Buttons
>   in a ButtonGroup, or between Toolbar groups).
> - **Sizes / weights** — `--border-thin` (1px), `--border-medium` (1.5px),
>   `--border-thick` (2px).
> - **Colors** — default `--separator`, accent-tinted, danger-tinted.
> - **Inset variants** — full-bleed, inset-md, inset-lg (left padding).
>
> ### Accordion (Accordion.Root → Item → Trigger → Content)
> - **Variants**: `light` (no chrome, just dividers), `bordered`, `splitted`
>   (each item is a separate card), `shadow`
> - **States**: closed, open, multiple-open
> - **Selection mode**: single (only one open), multiple
> - **With icon trigger**, **with description**, **with badge in trigger**
> - **Disabled item**
> - One example showing nested Accordion (an Accordion.Item containing
>   another Accordion)
>
> ### Disclosure & DisclosureGroup
> Render Disclosure as the lower-level primitive used to build Accordion:
> - Single Disclosure: closed / open states with chevron rotation
> - DisclosureGroup: 3 items, exclusive vs non-exclusive
> - With custom trigger (any node, not just a label)
>
> ### ScrollShadow
> Render four scrollable areas, each with shadows indicating overflow:
> 1. **Top + bottom shadows** when content overflows vertically (mid-scroll)
> 2. **Left + right shadows** when content overflows horizontally
> 3. **Top only** (scrolled to bottom)
> 4. **Bottom only** (scrolled to top)
>
> Each in a 320×240 box with sample content (a list of items). Annotate
> the shadow direction with arrows.

## Execution

```bash
pencil --out design/components/surfaces.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: the 4-depth Surface ladder is clearly visible in
both Light and Dark, all four ScrollShadow scenarios show the correct
shadow edges, Accordion variants demonstrate splitted vs bordered
treatments distinctly.
