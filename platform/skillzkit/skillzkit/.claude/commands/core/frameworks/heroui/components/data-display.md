---
description: Generate the Data Display component page — Table, Card, Avatar, Badge, Chip, Kbd.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/data-display.pen` — components that surface
information.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Table" })` and same
   for `Card`.

## Embedded prompt

> Build a Pencil page named **`Components / Data Display`** for **{{brand}}**.
> Light + Dark.
>
> ### Table (Table.Root → Header → Body → Row → Cell + Pagination) — Large Organism
> The Table at 1200px width qualifies as a Large Organism per
> `_context.md` rule 8 (default render > 800px and contains 3+
> molecules). Render the **default variant** at all three canonical
> breakpoints stacked vertically (vertical works better than side by
> side here because the desktop frame is itself ~1200px wide):
>
> - **Desktop (1440)** — full table at 1200px width with all columns
>   visible, sortable headers, action-menu cells, pagination footer
>   composed Pagination + page-size + total count.
> - **Tablet (768)** — column priority kicks in: secondary columns
>   (timestamps, metadata, less-critical metrics) collapse into an
>   expandable row drawer triggered by a chevron in the leading cell.
>   Sticky header still sticky. Pagination compresses to `Prev | 5 of
>   10 | Next` form.
> - **Mobile (390)** — tabular layout becomes a stacked card list:
>   each row renders as a Card with the primary identifier as title,
>   secondary fields as a definition-list-style content block,
>   actions in the Card.Footer. The "table" no longer reads as a
>   table; it reads as a list. Pagination becomes edges-only
>   (`First / Prev / Next / Last`).
>
> Annotate the transitions explicitly: `secondary columns → row
> drawer at md`, `tabular layout → card stack at sm`,
> `pagination → compact at md → edges-only at sm`.
>
> Render the **other variants** (`striped`, `bordered`, `compact`) at
> desktop width only — they're styling variations of the same
> responsive structure.
>
> Standard table contents to demonstrate across the 3 breakpoints:
> - **Header**: sortable columns (with sort-indicator arrows in two states),
>   resizable column hint, sticky header annotation
> - **Cells**: text, numeric (right-aligned + tabular-nums), badge cell,
>   avatar+name cell, action menu cell (kebab → Dropdown)
> - **Selection**: leftmost checkbox column, header indeterminate state,
>   selected-row visual treatment (`--accent-50` row background)
> - **Row states**: default, hover, selected, disabled, expanded (with sub-row)
> - **Empty state**: full-table empty illustration + CTA button
> - **Loading state**: skeleton rows
> - **Virtualization indicator**: scroll-shadow on top edge when scrolled
>
> ### Card (Card.Root → Header → Title → Description → Content → Footer)
> Render a 4×3 grid of card patterns:
> 1. **Stat card** — large number + label + delta arrow + sparkline
> 2. **Profile card** — Avatar + name + role + Follow button
> 3. **Media card** — image header + title + description + tag chips +
>    actions
> 4. **List card** — title + 3-row list with leading icons
> 5. **Pricing card** — tier name + price + feature checklist + primary CTA
> 6. **Empty card** — placeholder illustration + add CTA
> 7. **Selected/active card** — accent-tinted ring (radio-card pattern)
> 8. **Loading card** — skeleton variant
> 9. **Error card** — danger-tinted with retry action
> 10. **Compact card** — minimal: icon + title + chevron-right (link card)
> 11. **Pressable card** — with hover lift annotation
> 12. **Drag-handle card** — kanban-style with grip icon + drag-active state
>
> ### Avatar (Avatar.Root → Image → Fallback → Status)
> Sizes: `xs (16)`, `sm (24)`, `md (32)`, `lg (40)`, `xl (48)`, `2xl (64)`,
> `3xl (96)`. Each shown with: image, initials fallback, icon fallback
> (lucide `user`).
> Status indicator dot: `online`, `offline`, `busy`, `away`, in correct
> bottom-right placement per size.
> Avatar group: stacked (3, 5, 5+overflow), with `overlap-sm` and
> `overlap-md` settings.
>
> ### Badge (numeric / dot indicator on a parent)
> Render attached to bell-icon button: numeric (`5`, `99`, `99+`), dot,
> custom (e.g. `NEW`). Placements: `top-right` (default), `top-left`,
> `bottom-right`, `bottom-left`. Colors: `default`, `accent`, `danger`,
> `success`, `warning`. With border outline (to separate from busy parent).
>
> ### Chip (standalone tag, distinct from TagGroup)
> Render variants:
> - `solid`, `flat`, `bordered`, `light`, `dot`, `shadow`
> - Colors: full status palette
> - Sizes: `sm`, `md`, `lg`
> - With leading icon, with avatar, with close-button
> - Selected/unselected for filter-chip usage
>
> ### Kbd
> A row showing keyboard shortcuts: `⌘`, `⌘K`, `⌘ + Shift + P`,
> `Ctrl + Alt + Del`, `↑`, `↓`, `Enter`, `Esc`, `Tab`, `Space`. Two visual
> styles: `solid` (filled key cap) and `bordered` (outline only). Plus an
> example of Kbd inline inside a Tooltip and a ListBox item.

## Execution

```bash
pencil --out design/components/data-display.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: four table variants stacked, all 12 card patterns
rendered, full Avatar size scale visible, Badge placements correct on all
four corners.
