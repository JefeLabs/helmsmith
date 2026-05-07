---
description: Generate the feature-grid pattern page (3×2, 4×3, asymmetric layouts for showcasing product features). Establishes reusable feature-showcase compositions with the icon+title+description molecule pattern.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/feature-grid.pen` — five feature-grid
layouts that templates and landing pages compose.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for the icon library
   (`iconLibrary`) — feature grids use icon-driven feature cards.

## Embedded prompt

> Build a Pencil page named **`Patterns / Feature Grid`** for
> **{{brand}}**. Single 1440-wide canvas, 64px outer padding, 80px
> between rows. Render once on Light and once on Dark.
>
> Five grid layouts, each rendered at full 1440 width with sample
> feature content (real product features inferred from the brand
> brief, not lorem):
>
> ### Pattern 1 — 3×2 even grid
>
> Six features in 3 columns × 2 rows. Each cell:
> - Icon (40×40, `--color-accent-600`)
> - Title (h4, body)
> - Description (body-md, 2–3 lines, `--color-content-2`)
> - Optional "Learn more" link
>
> Use when: 6 evenly-weighted features, each deserving similar
> visual prominence.
>
> ### Pattern 2 — 4×3 dense grid
>
> Twelve features in 4 columns × 3 rows. Cells slightly more
> compact than Pattern 1:
> - Icon (32×32)
> - Title (h5)
> - Description (body-sm, 1–2 lines)
> - No links — terseness is the point
>
> Use when: longer feature lists where individual descriptions
> are short and the grid itself communicates breadth.
>
> ### Pattern 3 — Asymmetric "feature spotlight"
>
> 1 large feature card (60% width) + 2 small feature cards
> (20% each, stacked or side-by-side). The large card has a
> screenshot/illustration in addition to icon + title + description.
>
> Use when: one feature is the headline, others are supporting.
> Common for "primary capability + 2 secondary capabilities"
> framings.
>
> ### Pattern 4 — Bento grid (multi-size)
>
> 6 features in a Bento-style asymmetric layout:
> - 1 hero cell (8 col × 2 row)
> - 1 wide cell (4 col × 1 row)
> - 1 wide cell (4 col × 1 row)
> - 3 small cells (4 col × 1 row each)
>
> Each cell scales its content density to its size — hero cell has
> imagery + title + description + bullet list; small cells have
> icon + title + 1-line description.
>
> Use when: brand wants visual interest beyond a uniform grid.
> Common in modern marketing sites (Linear, Vercel).
>
> ### Pattern 5 — Vertical stagger (alternating)
>
> Each feature is a full-width row with text and visual on opposite
> sides, alternating per feature. Feature 1: text left, visual
> right. Feature 2: text right, visual left. Feature 3: text left.
> Each row 320–400px tall.
>
> Use when: features are deep enough to warrant a full row each
> (4–8 features), and the alternating layout adds visual rhythm
> over a scroll.
>
> ### Section 6 — Feature-card molecule reference
>
> A reference card showing the canonical feature-card molecule used
> across all grid patterns:
>
> Composition:
> - Icon container (8–16px padding, optional background tint
>   `--color-accent-50`)
> - Title (varies by grid: h4, h5, or h6)
> - Description (varies: body-md, body-sm)
> - Optional CTA link
>
> Variants:
> - Default (icon top-left, content below)
> - Centered (icon centered above content, all centered text)
> - Inline (icon left, content right, horizontal layout — for
>   sidebar-style placements)
>
> ### Section 7 — Composition rules (shared)
>
> Reference card:
> - **Even grids**: titles are 2–4 words, descriptions 8–18 words
> - **Bento grids**: hero cell can have richer content; others stay
>   terse
> - **Stagger pattern**: descriptions can be 30–80 words (longer
>   form)
> - **Visual hierarchy**: icons should NOT compete for attention —
>   monochrome (single brand color) preferred over multicolor
> - **Density rule**: 4×3 grids feel busy; if features warrant it,
>   prefer 3×2 with truncated lists or use the Bento pattern
>
> ### Section 8 — Responsive matrix
>
> A 3×5 grid showing all 5 patterns at desktop / tablet / mobile:
> - 3×2 → 2×3 tablet → 1×6 mobile (single column)
> - 4×3 → 2×6 tablet → 1×12 mobile
> - Asymmetric → stacks vertically on mobile, hero loses imagery
> - Bento → collapses to vertical stack on mobile, sizes equalize
> - Stagger → all rows become single-column stacked on mobile
>   (visual stays above text)
>
> ### Naming
> - Pattern frames: `feature-grid-{{pattern}}` (`-3x2`, `-4x3`,
>   `-asymmetric`, `-bento`, `-stagger`)
> - Feature card variants: `feature-card-{{variant}}`
> - Responsive cells: `feature-grid-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/feature-grid.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 5 grid patterns rendered with real
feature content, feature-card molecule reference present, composition
rules card, responsive matrix covers all 5 patterns × 3 breakpoints.
