---
description: Generate the Charts and Data Visualization component page — bar, line, area, sparkline, pie/donut, heatmap, treemap, gauge. Built on Recharts (already in the stack), composed with HeroUI v3 chrome (Card, Tooltip).
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/charts.pen` — the Data Visualization
component group covering the seven chart types every dashboard
product needs. Built on **Recharts** (already in the project stack).

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Data Visualization" })`.
3. Read `product/.pencil-brand.json` for the chart color sequence —
   chart palettes derive from the accent ramp + status colors. Each
   data series maps to a token in this order: `accent-500`,
   `accent-700`, `success-500`, `warning-500`, `info-500`,
   `accent-300`, `success-700`, `warning-700`.

## Embedded prompt

> Build a Pencil page named **`Components / Charts`** for **{{brand}}**.
> Use HeroUI v3 chrome where applicable (`Card.Root`, `Tooltip`)
> and reference Recharts as the underlying renderer in the
> compound API hints.
>
> ### Chart 1 — Bar (Bar.Root → Chart → Bars + Axis)
>
> Render four bar variants:
> - **Vertical** — single series, x-axis categorical
> - **Horizontal** — single series, y-axis categorical (better for
>   long category labels)
> - **Grouped** — multiple series side-by-side per category
> - **Stacked** — multiple series stacked vertically per bar
>
> Each at 480×320 with realistic data (8–12 data points). Show:
> - X/Y axis with tick labels and `--color-separator` gridlines
> - Hover tooltip pattern: dark-background card with category name +
>   value(s)
> - Legend (top or right) for grouped/stacked variants
> - Empty state pattern (uses `patterns/states.pen` empty-state)
> - Loading state (skeleton bars)
>
> ### Chart 2 — Line (Line.Root → Chart → Line + Axis)
>
> Render three line variants:
> - **Single line** — one series, time-axis x
> - **Multi-line** — 2–4 series, shared time axis, distinct
>   colors from the chart-color sequence
> - **Step line** — for state-change data (status over time, etc.)
>
> Each at 480×320. Show:
> - Smooth curve type (`type="monotone"` in Recharts)
> - Optional data point dots, visible on hover
> - Hover tooltip with all series at the hovered x
> - Legend for multi-line
> - Reference line / band patterns (e.g. "target: 100" annotated
>   horizontal line)
>
> ### Chart 3 — Area (Area.Root → Chart → Area + Axis)
>
> Render three area variants:
> - **Single area** — like a line but filled below
> - **Stacked area** — cumulative across series
> - **Stream / 100% stacked** — proportions over time, summing to
>   100% at every x
>
> Each at 480×320. Color treatment uses gradient fills referencing
> the brand's chart-color sequence at low opacity (alpha 0.2 for
> single, layered at 0.6 for stacked).
>
> ### Chart 4 — Sparkline (Sparkline.Root → Chart)
>
> A small inline-chart variant for stat cards and table cells:
> - 80×24 default size, no axis labels, minimal styling
> - Variants: line, area, bar
> - Used inside `Stat.Root` (`Card` from data-display) and as a
>   table cell renderer
> - Render 6 sparklines in a row showing common use cases:
>   - Trending up (positive delta)
>   - Trending down (negative delta)
>   - Volatile
>   - Flat
>   - With reference line
>   - As bar variant
>
> ### Chart 5 — Pie / Donut (Pie.Root → Chart)
>
> Render three variants:
> - **Pie** — solid segments, center empty
> - **Donut** — solid segments with center hole, optional center
>   label (total or selected segment)
> - **Half-donut / radial gauge** — semicircle for single-metric
>   progress
>
> Each at 320×320. Limit to 5–7 segments max (more becomes
> unreadable). Show:
> - Direct labels on segments where they fit, leader lines for
>   small segments
> - Hover state highlights one segment, dims others to 0.5 opacity
> - Legend always present, color-keyed
>
> ### Chart 6 — Heatmap (Heatmap.Root → Chart)
>
> Render two variants:
> - **Calendar heatmap** — 7-day-wide grid of cells over time (the
>   "GitHub contribution graph" pattern). Cells colored from
>   `--color-accent-100` (low) to `--color-accent-700` (high)
> - **Matrix heatmap** — labeled rows × labeled columns of cells.
>   Same color ramp logic
>
> Each at 480×240 (calendar) or 480×320 (matrix). Show:
> - Cell hover tooltip with date/coordinate + value
> - Color scale legend (gradient bar with min/max labels)
> - Empty cells distinguished from zero-value cells
>
> ### Chart 7 — Treemap (Treemap.Root → Chart)
>
> Hierarchical visualization using nested rectangles:
> - 480×320, 1–2 levels of nesting
> - Each rectangle sized proportional to its value, colored by
>   category from the chart-color sequence
> - Cell label shown if rectangle is large enough; truncated or
>   omitted otherwise
>
> Use cases: portfolio breakdown, category share, file-size
> visualization.
>
> ### Chart 8 — Gauge (Gauge.Root → Chart)
>
> Single-metric progress visualization:
> - Half-circle dial (180° arc) with needle or filled arc
> - Min/max labels at the ends
> - Value displayed prominently in center
> - Optional zones (green / yellow / red bands per threshold)
>
> Render two: a basic gauge and a multi-zone gauge with thresholds.
>
> ### Section 9 — Chart-card composition
>
> A reference for the canonical "chart inside a card" composition
> that's how charts actually appear in dashboards:
>
> ```
> <Card.Root>
>   <Card.Header>
>     <Card.Title>Active Users</Card.Title>
>     <Card.Description>Last 30 days</Card.Description>
>     <Card.Actions>
>       [time-range select] [overflow menu]
>     </Card.Actions>
>   </Card.Header>
>   <Card.Content>
>     [Chart at full card width]
>   </Card.Content>
>   <Card.Footer>
>     <Card.Stat>+12.4% vs prev. period</Card.Stat>
>   </Card.Footer>
> </Card.Root>
> ```
>
> Render 4 chart cards in a 2×2 grid showing this pattern:
> - Line chart with stat footer
> - Bar chart with stat footer
> - Donut with center stat
> - Sparkline + big-number combination
>
> ### Section 10 — Color sequence reference
>
> A reference card showing the chart-color sequence with usage rules:
>
> | # | Token            | Default Use         |
> | - | ---------------- | ------------------- |
> | 1 | `--color-accent-500`   | Primary series        |
> | 2 | `--color-accent-700`   | Secondary series      |
> | 3 | `--color-success-500`  | Positive comparison   |
> | 4 | `--color-warning-500`  | Threshold / caution   |
> | 5 | `--color-info-500`     | Tertiary series       |
> | 6 | `--color-accent-300`   | Quaternary series     |
> | 7 | `--color-success-700`  | Higher-tier positive  |
> | 8 | `--color-warning-700`  | Higher-tier caution   |
>
> Charts with >8 series should consider whether they can group or
> filter — readability collapses fast.
>
> ### Section 11 — Empty / loading / error states (per chart type)
>
> A 3-column row showing the three states for one chart (line):
> - Empty: "No data for this period" with the empty-state pattern
> - Loading: skeleton chart (gray rectangles in the chart area)
> - Error: "Couldn't load this chart" with retry, using the section-
>   error pattern from `patterns/states.pen`
>
> ### Section 12 — Accessibility for charts
>
> Reference card listing chart-specific a11y requirements:
> - Every chart includes a `<figcaption>` summarizing what's visible
>   ("Bar chart showing monthly users from January to December.
>   Peak: 4,200 in October.")
> - Color is never the only signal — use patterns, shapes, or
>   labels in addition (especially for charts viewed by colorblind
>   users)
> - Hover tooltips also work on focus (keyboard navigation through
>   data points via arrow keys)
> - Data table fallback: every chart has a "View as table" toggle
>   that swaps to a structured table for screen-reader users
> - Animations on chart load respect `prefers-reduced-motion`
>
> ### Naming
> - Chart frames: `chart-{{type}}-{{variant}}` (e.g.
>   `chart-bar-vertical`, `chart-line-multi`)
> - State frames: `chart-{{type}}-empty`, `-loading`, `-error`
> - Reference frames: `chart-card-composition`, `color-sequence`,
>   `chart-a11y`

## Execution

```bash
pencil --out design/components/charts.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 8 chart types covered with all listed
variants, chart-card composition reference, color sequence reference,
states-row, accessibility reference. Each chart uses theme tokens
exclusively (no inline hex in chart configurations).

## Component contract

Charts are wrappers around Recharts components — they don't
re-implement charting. The component implementation:

```tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export const ActiveUsersChart = ({ data }) => (
  <ResponsiveContainer width="100%" height={320}>
    <LineChart data={data}>
      <XAxis dataKey="date" />
      <YAxis />
      <Tooltip content={<CustomTooltip />} />
      <Line
        type="monotone"
        dataKey="users"
        stroke="var(--color-accent-500)"
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4 }}
      />
    </LineChart>
  </ResponsiveContainer>
);
```

Custom tooltips use HeroUI Card chrome to maintain visual
consistency. The `stroke` and other color props always reference
theme variables.
