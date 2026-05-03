---
description: Generate the Navigation component page — Tabs, Breadcrumbs, Pagination, Link, Toolbar.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/navigation.pen`.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Tabs" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Navigation`** for **{{brand}}**.
> Light + Dark.
>
> ### Tabs (Tabs.Root → List → Trigger → Indicator → Panel)
> Render the variant matrix:
> - Variants (rows): `underline` (default), `solid` (pill background),
>   `bordered`, `light` (no chrome), `secondary`
> - Orientation: horizontal (above) and vertical (left rail) for the
>   `underline` variant
> - Sizes: `sm`, `md`, `lg` row of `underline` primary
> - Tab states inline: `default`, `hover`, `active`, `disabled`
> - With icons: leading icon + label, icon-only tabs
> - With badges: tab label with a numeric Badge (e.g. `Inbox 12`)
> - With Tabs.Separator between two tabs (the new v3 Beta-13 separator)
> - **Scrollable** tablist — render at constrained 400px width with overflow
>   chevrons left/right
> - One tabset showing a Panel with sample content below to demonstrate the
>   indicator alignment
>
> ### Breadcrumbs (Breadcrumbs.Root → Item → Separator → CurrentPage)
> Three patterns:
> - Standard chevron-separated: `Home / Projects / Acme / Settings`
> - Slash-separated alternative
> - With dropdown collapse: when path is too long, middle items collapse
>   into a `...` Dropdown trigger (show open state)
> - Sizes: `sm`, `md`, `lg` rows
>
> ### Pagination (Pagination.Root → Prev → Page → Ellipsis → Next)
> Render variants:
> - Numbered (`1 2 3 ... 10`) — pages 5 of 10 selected, sm/md/lg sizes
> - Compact (`Prev | 5 of 10 | Next`)
> - Edges only (`First / Prev / Next / Last`)
> - With "page-size" select on the right (`Rows per page: 25`)
> - Loading state (current page swapped for spinner)
>
> ### Link (Link.Root)
> Variants:
> - `primary`, `foreground`, `success`, `warning`, `danger`, `secondary`
> - States: `default`, `hover` (with underline animation cue),
>   `visited`, `focus-ring`, `external` (with trailing external-link icon)
> - As button (`role="link"` styled like Button.Link variant — bridge to
>   Button page)
> - Inline link inside a paragraph showing how it composes within text
>
> ### Toolbar (Toolbar.Root → Group → Separator)
> Three realistic toolbars:
> 1. **Editor toolbar** — formatting buttons grouped (B / I / U) | (Align
>    L/C/R) | (List / Quote) | (Undo / Redo). Standard organism — render
>    once at default width.
> 2. **App toolbar** — left: brand mark + breadcrumbs; center: search; right:
>    notifications + avatar menu. **Qualifies as a Large Organism**
>    (page-section primitive per `_context.md` rule 8). Render at all
>    three canonical breakpoints side by side: `Mobile (390)`,
>    `Tablet (768)`, `Desktop (1440)`. Show how the composition reflows:
>    breadcrumbs collapse to a back-arrow + truncated current page on
>    mobile; central search becomes a search-icon trigger that opens a
>    full-screen sheet; notifications + avatar collapse into a single
>    overflow Dropdown at narrow widths.
> 3. **Filter toolbar** — TagGroup of active filters + clear-all button +
>    sort dropdown + view-toggle (grid/list ToggleButtonGroup). If the
>    target page renders this at full viewport width, treat as Large
>    Organism and render at all three breakpoints (filters wrap onto
>    multiple rows on mobile; clear-all sticks to the right; sort and
>    view-toggle collapse into a single "Sort & view" Dropdown trigger
>    at sm).
>
> ### NavBar template snippet — Large Organism, 3 breakpoints
> One full top-nav bar composed of Toolbar + Link + Avatar + ButtonGroup —
> referenced by the landing-page template. Per `_context.md` rule 8 this
> is a Large Organism (page-section primitive). Render at **all three
> canonical breakpoints** side by side:
>
> - **Desktop (1440)**: brand mark on the left, full nav links centered
>   (5–7 items), Search + Notifications + Avatar + primary-CTA Button on
>   the right.
> - **Tablet (768)**: brand mark + abbreviated nav (3–4 items max),
>   right-side actions still visible but compressed; secondary nav items
>   move into a "More" Dropdown.
> - **Mobile (390)**: brand mark + hamburger Drawer trigger on the left,
>   single primary action on the right; everything else (full nav,
>   notifications, search, avatar menu) collapses into the Drawer or a
>   bottom-sheet variant.
>
> Annotate every transition with arrows or callouts so the responsive
> rules are reviewable: `nav-links → drawer trigger at md`,
> `search input → icon-only at sm`, `secondary actions → overflow at sm`.

## Execution

```bash
pencil --out design/components/navigation.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: all five Tabs variants present (one in vertical
orientation), three Breadcrumbs patterns, all five Pagination variants,
three real toolbars (with App Toolbar and Filter Toolbar rendered at
all three canonical breakpoints per rule 8), one composed NavBar at
the bottom rendered at Mobile/Tablet/Desktop side by side with
responsive transition annotations.
