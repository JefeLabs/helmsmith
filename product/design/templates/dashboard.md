---
description: Generate the dashboard / app-shell template with three canonical layouts (single-panel, master-detail, split-pane). Establishes the chrome (sidebar nav, top header, content region) every product app needs and the layouts content adopts within that chrome.
argument-hint: [--layouts single-panel,master-detail,split-pane] [--with-search] [--collapsible-nav] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/dashboard.pen` — the app-shell chrome plus
the three canonical content layouts that products adopt within it.
Every product with a logged-in surface needs this. One product needs it
for an agent telemetry view; another for tournament management; another for customer support.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for brand mark and accent.
3. Read `patterns/states.pen` reference (uses empty/loading/error
   states across the layouts).

## Embedded prompt

> Build a Pencil page named **`Templates / Dashboard`** for
> **{{brand}}**. Render at the canonical 3 breakpoints (mobile 390,
> tablet 768, desktop 1440) per `_context.md` rule 8.
>
> ### Shared chrome (all layouts)
>
> The app shell is the same across all three layouts:
>
> - **Left sidebar** (240px wide on desktop, collapsible to 64px
>   icon-only mode):
>   - Brand mark at top (logo lockup)
>   - Primary nav: 6–9 links, each with icon + label, grouped by
>     section if needed
>   - Active link highlighted with `--color-accent-100` background
>     + `--color-accent-700` text
>   - Bottom: workspace switcher (if multi-tenant) + user menu
>     (avatar + name + chevron → menu with profile / settings /
>     sign out)
>
> - **Top header** (64px tall, full width minus sidebar):
>   - Page title + breadcrumbs (left)
>   - Global search input (center, optional via `--with-search`)
>   - Action buttons (right): notifications bell, help icon,
>     "+ New" primary action button per page context
>
> - **Content region**: takes remaining space, scrollable
>   independently of the chrome.
>
> ### Layout 1 — Single-panel
>
> Content region is one focused area. Use cases: settings landing,
> dashboard overview, list of items.
>
> Composition:
> - Page header inside content (title + description + actions)
> - Optional filter / search bar
> - Main content (cards, table, grid, etc.)
> - Optional sticky footer for batch actions when items selected
>
> Example renders for this layout:
> - **Dashboard overview**: 4-stat row + 2-column chart grid +
>   recent-activity feed
> - **Item list**: filter bar + data table (uses
>   `frameworks/heroui/components/data-display.pen` Table)
>
> ### Layout 2 — Master-detail
>
> Two-pane: list of items on the left, selected-item details on the
> right. Use cases: messages/inbox, tickets, file browser, customer
> records.
>
> Composition:
> - Master pane (320px wide on desktop): list of items with search
>   + filters at top, scrollable list below. Active item highlighted.
> - Detail pane (remaining width): full record view of the selected
>   item. Includes title, metadata, body content, action toolbar.
> - Empty state when no item selected: "Select an item to view
>   details" (uses `patterns/states.pen` empty pattern)
>
> Variants:
> - **Persistent master**: master always visible, even on tablet
> - **Collapsing master**: master collapses to icons/back-button on
>   mobile, returning to list view requires the back action
>
> ### Layout 3 — Split-pane
>
> Two equal-weight panes side by side, each with its own scroll.
> Use cases: code editor + preview, query + results, chat + thread
> detail.
>
> Composition:
> - Left pane (50% width adjustable via drag handle): primary work
>   area
> - Drag-handle separator (4px wide, `--color-separator`, hover
>   shows resize cursor)
> - Right pane (50% width adjustable): secondary / output area
>
> Variants:
> - **Vertical split**: left/right (most common)
> - **Horizontal split**: top/bottom (less common, for code +
>   terminal patterns)
> - **Resizable**: drag handle adjusts panes (default)
> - **Fixed split**: equal split, no drag (simpler implementations)
>
> ### Section 4 — Empty / loading / error states (per layout)
>
> Each layout's content area must render the three patterns from
> `patterns/states.pen`:
>
> - **Empty**: "No [items] yet" with primary CTA (single-panel),
>   "Select an [item]" placeholder (master-detail), "Get started"
>   (split-pane)
> - **Loading**: skeleton matching the eventual layout (table rows,
>   list items, panel content)
> - **Error**: section-error variant for content-region failures;
>   does not affect chrome
>
> Render one example per layout/state combination — a 3×3 grid
> showing all 9 combinations.
>
> ### Section 5 — Responsive behavior
>
> A canonical-3-breakpoint render per layout:
>
> **Single-panel**:
> - Desktop: chrome + content as described
> - Tablet: sidebar collapses to icon-only by default; content
>   takes full width
> - Mobile: sidebar becomes off-canvas drawer (hamburger toggle
>   in header); content fills viewport
>
> **Master-detail**:
> - Desktop: master + detail side by side
> - Tablet: master narrows to 280px, detail takes remainder
> - Mobile: master is the default view; selecting an item navigates
>   to detail (back button returns to master)
>
> **Split-pane**:
> - Desktop: side-by-side, resizable
> - Tablet: side-by-side, fixed 50/50
> - Mobile: stacks vertically (top/bottom), drag to resize the
>   horizontal split point
>
> ### Section 6 — Sidebar nav reference
>
> A reference card showing canonical navigation patterns:
>
> | Pattern             | When to use                                |
> | ------------------- | ------------------------------------------ |
> | Flat list           | 6 or fewer top-level destinations          |
> | Grouped sections    | 7+ destinations grouped by feature area    |
> | Nested expand       | Hierarchical nav (parent → children)       |
> | Pinned + collapsible | "Favorites" pinned list above "All sections" |
>
> Reference includes the data-attribute pattern for active state:
> `[data-active="true"]` instead of class-name flagging.
>
> ### Naming
> - Frame names: `dashboard-{{layout}}-{{breakpoint}}`
> - Chrome reference: `app-shell-chrome`
> - Per-state frames: `dashboard-{{layout}}-{{state}}` (where state =
>   empty / loading / error)

## Execution

```bash
pencil --out design/templates/dashboard.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm:
- Shared chrome (sidebar + header + content) consistent across all
  three layouts
- Three layouts rendered: single-panel, master-detail, split-pane
- Each layout has empty / loading / error state examples
- All three layouts rendered at canonical 3 breakpoints
- Sidebar nav reference card present
