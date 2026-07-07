---
description: Generate the stat-section pattern page (single-stat hero, multi-stat row, stat-with-comparison, stat-grid, stat-with-illustration). Establishes reusable metric-showcase compositions for landing pages and dashboards.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/stat-section.pen` — five stat-showcase
patterns. Stats convey credibility and progress at a glance — the
patterns differ by how much story each stat carries.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.

## Embedded prompt

> Build a Pencil page named **`Patterns / Stat Section`** for
> **{{brand}}**. Single 1440-wide canvas, 64px outer padding, 80px
> between rows. Render once on Light and once on Dark.
>
> ### Pattern 1 — Single-stat hero
>
> One large stat dominating the section:
> - Large number (display-2xl or display-xl)
> - Label below (h4 or h5)
> - Optional context line (body-md, "since 2020", "in last quarter")
> - Centered or asymmetric placement
> - Background: brand-tinted gradient or pattern overlay (per
>   imagery direction)
>
> Use when: marketing pages where one stat is the headline
> ("10,000+ schools served", "$50M raised").
>
> ### Pattern 2 — Multi-stat row (3-up or 4-up)
>
> Three or four stats in equal-width columns:
> - Each: number (display-xl) + label (body-md) + optional context
> - Vertical separators between (subtle `--color-separator`)
> - Background: `--color-surface-raised` or transparent
>
> Use when: marketing pages communicating breadth of impact across
> multiple dimensions ("schools served · students engaged · staff
> trained · districts onboarded").
>
> ### Pattern 3 — Stat with comparison / delta
>
> Stat with explicit before/after or current/comparison context:
> - Primary number (display-xl)
> - Delta indicator: ↑ or ↓ + percentage change
> - Comparison label ("vs last quarter", "industry average")
> - Optional sparkline showing trend (uses sparkline component
>   from `frameworks/heroui/components/charts.pen`)
>
> Variants:
> - **Positive delta**: green up-arrow + `--color-success-600` text
> - **Negative delta** (when reduction is good — "30% less waiting
>   time"): green down-arrow + `--color-success-600` text
> - **Negative delta** (when reduction is bad — "user retention
>   dropped"): red down-arrow + `--color-danger-600` text
> - **Neutral**: gray dash + `--color-content-2` text
>
> Use when: dashboards, performance reports, KPI summaries.
>
> ### Pattern 4 — Stat grid (2×2 or 3×3)
>
> Multiple stats in a grid, each in its own card:
> - Each card: number + label + optional sparkline / icon
> - Equal cell sizes
> - Background per card: `--color-surface-raised`
>
> Use when: dashboard summary sections, metrics overview pages,
> any context where 4–9 stats need equal visual weight.
>
> ### Pattern 5 — Stat with illustration
>
> Stat paired with a thematic visual:
> - Illustration / icon on one side (per imagery direction)
> - Number + label + context on the other side
> - 50/50 or asymmetric layout
>
> Use when: marketing pages where the stat needs visual support
> (the illustration anchors the stat's emotional resonance).
>
> ### Section 6 — Stat-card molecule reference
>
> Detailed breakdown of the canonical stat-card composition:
>
> Required:
> - Number — usually the largest text in the card. Use
>   `tabular-nums` font feature so digits align across multiple
>   stat cards.
> - Label — describes what the number measures.
>
> Optional:
> - Currency / unit prefix or suffix (`$`, `%`, `users/day`)
> - Context line — when, vs what, source attribution
> - Delta indicator — for comparison stats
> - Sparkline — for trend visibility
> - Icon — for category recognition
>
> Number formatting rules:
> - **Round to 2–3 significant figures** for marketing stats
>   ("10K+", "$2.4M") — false precision undermines trust
> - **Show full precision** for dashboard stats ("$2,453,891") where
>   exactness matters
> - **Avoid mixing units within a row** (don't put "10K users" next
>   to "$2.4M revenue" — the reader's eye can't compare them; use
>   different sections)
>
> ### Section 7 — Number-format reference
>
> A reference card showing canonical number formats:
>
> | Stat type        | Marketing format | Dashboard format |
> | ---------------- | ---------------- | ---------------- |
> | Count (small)    | "1,234"          | "1,234"          |
> | Count (large)    | "10K+", "1M+"   | "10,432" / "1,234,567" |
> | Currency (small) | "$50"            | "$49.99"         |
> | Currency (large) | "$2.4M"          | "$2,403,891"     |
> | Percentage       | "85%"            | "84.7%"          |
> | Time             | "5 min"          | "00:05:23"       |
> | Ratio            | "3:1"            | "3.21:1"         |
>
> Use `Intl.NumberFormat` with locale awareness (per the i18n
> foundation) — "$2.4M" in en-US becomes "2,4 Mio €" in de-DE.
>
> ### Section 8 — Source attribution
>
> Reference card:
>
> Stats without sources are weaker than they look. For credibility
> stats (used in marketing), include:
>
> - Inline source: "(2025 Annual Customer Survey)"
> - Methodology link: "How we measure this"
> - Date stamp: "as of January 2025"
>
> Stats from internal product analytics don't always need
> attribution (the user implicitly accepts the source) but
> dashboards benefit from "Updated 5 minutes ago" timestamps for
> data freshness.
>
> ### Section 9 — Responsive behavior
>
> A 3-row strip showing patterns at desktop / tablet / mobile:
> - Single-stat hero: same composition, reduces font sizes
> - Multi-stat row: 4-up → 2×2 tablet → 1-col stack mobile
> - Stat with comparison: maintains horizontal layout, reduces
>   sparkline size
> - Stat grid: 3×3 → 2×N → 1×N
> - Stat with illustration: side-by-side → stacked (illustration
>   above)
>
> ### Naming
> - Pattern frames: `stat-{{pattern}}` (`-single-hero`,
>   `-multi-row`, `-with-comparison`, `-grid`, `-with-illustration`)
> - Molecule reference: `stat-card-canonical`
> - Format reference: `number-format-reference`
> - Responsive cells: `stat-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/stat-section.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 5 stat patterns, stat-card molecule
reference, number-format reference table, source-attribution card,
responsive matrix complete.
