---
description: Generate the list / index page template — search + filters + table-or-grid + pagination. The "view many of X" page that pairs with detail. Used for any "browse records" page.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/list.pen` — the canonical "browse many
records" template. Pairs with the detail template (clicking a row
navigates to detail).

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. Read `templates/dashboard.pen` for chrome.
4. Read `patterns/states.pen` for empty/loading/error states.

## Embedded prompt

> Build a Pencil page named **`Templates / List`** for **{{brand}}**.
> Render at the canonical 3 breakpoints.
>
> ### Layout
>
> Inside the dashboard chrome:
>
> Composition:
> - **Page header**: title + description + primary action (right)
> - **Filter / search bar**: search input + filter chips +
>   view-mode toggle
> - **Content region**: table OR grid OR map view
> - **Footer**: pagination controls
>
> ### Page header
>
> - Title (h1, display-md) + brief description (body)
> - Primary action button on right ("+ New customer", "+ Create project")
> - Optional secondary actions: "Import", "Export"
>
> ### Filter / search bar
>
> - **Search input** (left, ~320px): icon + placeholder ("Search
>   customers...")
> - **Filter chips** (center): each chip shows active filter ("Status:
>   Active", "Owner: Me") with × to remove
> - **Add filter** chip: "+ Filter" opens dropdown with available
>   filter dimensions
> - **View toggle** (right): table / grid / map (when applicable)
> - **Sort selector** (right): "Sort: Recent" dropdown
> - **Bulk actions** (appears when rows selected): "X selected" +
>   action buttons (Delete, Export, Tag, etc.)
>
> ### Content view 1 — Table
>
> Standard data table (uses `frameworks/heroui/components/data-display.pen` Table):
> - Sortable column headers (chevron indicators)
> - Selection checkboxes (left column)
> - Row hover state
> - Inline status badges, avatars, dates
> - Row click navigates to detail page
> - Row actions overflow (3-dot icon, right column)
>
> Use when: text-heavy data, comparison across records, default for
> most list views.
>
> ### Content view 2 — Grid (cards)
>
> Cards in a 3 or 4-column grid:
> - Each card: optional image/avatar + title + key metadata + status
>   badge + action menu
> - Card click navigates to detail
> - Hover elevation
>
> Use when: visual records (people, products, locations), lower
> information density acceptable.
>
> ### Content view 3 — Map (when applicable)
>
> For geographic data:
> - Map taking 60–70% width
> - List of records (sidebar) showing items currently in viewport
> - Click pin → highlights in list, click list item → centers map
>
> ### Pagination footer
>
> Variants:
>
> 1. **Numbered pagination**: "1 ... 4 5 6 ... 12" with prev/next
>    arrows. Best for finite, browsable lists.
> 2. **Cursor pagination** (Load more): "Showing 50 of 247" with
>    "Load more" button. Best for chronological feeds.
> 3. **Infinite scroll**: auto-loads next batch as user scrolls.
>    Best for content feeds; avoid for actionable lists.
>
> ### Section 5 — Filter patterns reference
>
> A reference card showing canonical filter patterns:
>
> | Filter type        | Control                                    |
> | ------------------ | ------------------------------------------ |
> | **Categorical**    | Multi-select dropdown with checkboxes      |
> | **Date range**     | Date picker pair (or quick-select: Today / Last 7 / 30 / 90 days) |
> | **Numeric range**  | Slider OR min/max input pair               |
> | **Boolean**        | Toggle chip (on/off)                       |
> | **Search-driven**  | Text-input chip with type-ahead suggestions |
> | **Saved filter**   | Named preset chip ("My team's open tickets") |
>
> ### Section 6 — Empty / loading / error / no-results states
>
> Each rendered per `patterns/states.pen`:
>
> - **Empty (never-used)**: "No customers yet — create your first one"
>   with CTA, illustration
> - **Empty (filtered)**: "No customers match your filters" with
>   clear-filters CTA
> - **Loading**: skeleton table (10 placeholder rows) or skeleton
>   grid (12 placeholder cards)
> - **Error**: section error with retry
>
> Render all 4 states in a 2×2 grid.
>
> ### Section 7 — Bulk-action patterns
>
> When rows selected:
>
> - **Top action bar replacement**: filter bar transforms into
>   "X selected" + actions (most common)
> - **Floating action bar**: bottom-of-viewport toast-like bar
>   showing actions (preserves filter context)
> - **Sidebar actions panel**: drawer slides in from right with
>   bulk action options
>
> Reference each pattern with annotation.
>
> ### Section 8 — Responsive behavior
>
> A canonical-3-breakpoint render:
>
> - Desktop (1440): full table view, all columns visible, sidebar
>   filters expanded
> - Tablet (768): table with horizontal scroll OR card grid (2-col),
>   filters collapse to dropdown menu
> - Mobile (390): card grid (1-col) replaces table; filters become
>   bottom-sheet drawer triggered by filter button; pagination
>   becomes "Load more"
>
> ### Naming
> - Frame names: `list-{{view}}-{{breakpoint}}`
>   (e.g. `list-table-desktop`, `list-grid-mobile`)
> - State frames: `list-{{state}}` (`-empty-never-used`,
>   `-empty-filtered`, `-loading`, `-error`)
> - Reference frames: `filter-patterns`, `bulk-action-patterns`,
>   `pagination-patterns`

## Execution

```bash
pencil --out design/templates/list.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 3 content views (table, grid, map),
4 state examples, filter patterns + bulk action + pagination
references, canonical 3 breakpoints rendered for the table view.
