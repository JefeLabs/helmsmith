---
description: Generate the Feedback component page — Alert, Toast, ProgressBar, ProgressCircle, Meter, Skeleton, Spinner.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/feedback.pen` — every "tell the user something
is happening or happened" component.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Alert" })` and same
   for `Toast`, `ProgressBar`.

## Embedded prompt

> Build a Pencil page named **`Components / Feedback`** for **{{brand}}**.
> Light + Dark.
>
> ### Alert (Alert.Root → Icon → Title → Description → Actions)
> 4×4 matrix:
> - Status (rows): `info`, `success`, `warning`, `danger`
> - Variants (columns): `solid`, `flat`, `bordered`, `faded`
> - Each cell is a single Alert at md size with its appropriate icon
>   (lucide `info`, `check-circle-2`, `alert-triangle`, `alert-octagon`).
> - Below the matrix: Alert with action buttons (one + two), Alert with
>   close-button, Alert as banner (full width), Alert in a stack (two
>   stacked alerts).
>
> ### Toast (Toast.Root → Title → Description → Action → Close)
> A reference card showing all four toast statuses + a `loading` toast
> (with spinner) + a `promise` toast (loading → success transition shown
> as two adjacent toasts with an arrow between).
> Show the Toast.Provider position grid: 9 placements (top/middle/bottom
> × left/center/right) marked on a small viewport diagram.
>
> ### ProgressBar
> - Determinate: 0%, 25%, 50%, 75%, 100%, all in `accent` color, md size.
> - Indeterminate: animated stripe (Pencil should show motion arrows in the
>   spec).
> - Sizes row: `sm`, `md`, `lg`.
> - Color row: each of `accent`, `success`, `warning`, `danger` at 60%.
> - With label + value above bar.
>
> ### ProgressCircle
> - Sizes: `sm` (24), `md` (40), `lg` (64), `xl` (96), each at 65%.
> - Colors: `accent`, `success`, `warning`, `danger`.
> - With center label showing percentage and with center icon (success
>   check at 100%).
> - Indeterminate variant.
>
> ### Meter
> Three rows showing different value states:
> - Capacity meter (storage usage) — green at 30%, amber at 70%, red at 95%.
> - Score meter — sectioned ranges (poor / fair / good / excellent) with
>   the indicator at "good".
> - Strength meter (password) — 4 segments, 3 filled (green).
>
> ### Skeleton
> Compose realistic loading placeholders:
> - Avatar + two text lines (notification skeleton)
> - Card skeleton (image block + title + description)
> - Table row skeleton (5 columns)
> - Chart skeleton (bar chart placeholder)
> Each in animated shimmer style — annotate the shimmer direction.
>
> ### Spinner
> Sizes: `xs`, `sm`, `md`, `lg`, `xl`. Colors: `current` (default),
> `accent`, `content-3`. Three variants: ring, dots, pulse.

## Execution

```bash
pencil --out design/components/feedback.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Check: 4×4 alert matrix complete, Toast position grid present,
all four progress representations (linear / circle / meter / spinner)
rendered.
