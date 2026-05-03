---
description: Generate a visual diff between two .pen file versions. Surfaces structural changes (added/removed/moved frames), token changes (color/font/spacing shifts), and pixel deltas per frame. Output is a third .pen showing the diff side-by-side, plus an HTML report suitable for PR review.
argument-hint: <a.pen> <b.pen> [--out <path>] [--scope frames|tokens|both] [--threshold <0.0-1.0>] [--ignore <pattern>] [--html-report <path>] [--fail-on changed|removed|added|any]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Compute a visual and structural diff between two `.pen` versions.
Designed for design-review PRs and pre-merge sanity checks — surfaces
what changed at the level designers actually care about (which frames
moved, which tokens shifted, which pixels differ) rather than as a
text-mode JSON diff that nobody can read.

The diff is **directional**: A is the baseline, B is the candidate.
"Added" means in B but not in A; "removed" means in A but not in B.
Reverse the order if you want the inverse semantic.

Output: a third `.pen` file containing three side-by-side panels per
changed frame (Before / After / Diff), plus an optional HTML report
suitable for posting in a PR.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Validate both inputs:
   - Both must be `.pen` files that exist on disk.
   - If either is a git-relative path (`HEAD~1:design/pages/x.pen`),
     resolve via `git show` to a temp file before processing.
   - If either fails to open, report the error and stop.
3. Resolve flags:
   - `--out <path>` — output `.pen` path. Default
     `design/.diffs/<a-slug>-vs-<b-slug>.pen`.
   - `--scope frames|tokens|both` — what to diff. Default `both`.
     `frames` skips token-level diffs (faster). `tokens` skips
     visual diffing (just compares the token references).
   - `--threshold <0.0-1.0>` — pixel-diff threshold for marking a
     frame "changed". Default `0.05` (5% of pixels differ).
   - `--ignore <pattern>` — glob pattern for frame names to skip
     (repeatable). Useful for ignoring `.previews/`, status badges,
     timestamps, etc.
   - `--html-report <path>` — write an HTML report at the given
     path. Default `design/.diffs/<a-slug>-vs-<b-slug>.html`.
     Pass `--no-html` to skip.
   - `--fail-on changed|removed|added|any` — exit with non-zero
     status if findings of the specified type are present. Useful
     in CI to gate PRs on design changes.

## Phase 1 — Frame inventory

For each `.pen`, extract the frame inventory:

1. List all top-level pages (canvases) and their frames.
2. For each frame: name, parent canvas, position (x, y, width,
   height), visible token references (color, font, radius, shadow,
   spacing), child component instances.
3. Build a flat manifest keyed by `<canvas>/<frame-name>`:

```jsonc
{
  "Atoms/button-primary-md":     { "x": 80,  "y": 80,  "w": 120, "h": 40, "tokens": { "fill": "--accent-500", "radius": "--radius-md" } },
  "Atoms/button-primary-lg":     { ... },
  "Pages/dashboard-desktop":     { ... }
}
```

Use Pencil MCP `get_editor_state` for fidelity; CLI fallback uses
`pencil --in <file>.pen --query 'list-frames-deep'`.

## Phase 2 — Structural diff

Walk both manifests and classify each frame key:

| State        | A has it | B has it | Action                          |
| ------------ | -------- | -------- | ------------------------------- |
| `unchanged`  | ✅       | ✅       | Skip in diff output (or include with `--include-unchanged`) |
| `added`      | ❌       | ✅       | Render in B's panel only, mark green |
| `removed`    | ✅       | ❌       | Render in A's panel only, mark red |
| `moved`      | ✅       | ✅       | Same name + tokens, different position. Render with arrow showing motion |
| `resized`    | ✅       | ✅       | Same name + position, different dimensions. Render both with overlay |
| `restyled`   | ✅       | ✅       | Same name + structure, different tokens. Render both with token diff |
| `relocated`  | ✅       | ✅       | Same name, different parent canvas. Rare but legal — render with note |
| `pixel-diff` | ✅       | ✅       | Same name + tokens, different visual output (font rendering, child changes). Render with pixelmatch heatmap |

Frames matching `--ignore` patterns are excluded from classification.

## Phase 3 — Token-level diff (when `--scope` includes tokens)

Walk every token reference across all frames in both `.pen`s and
compute the per-token diff:

```
Token changes (A → B):
  --accent-500:    #0A84FF → #2E1065   (24 frames affected)
  --font-display:  Inter   → Fraunces  (8 frames affected)
  --radius-md:     8px     → 6px       (47 frames affected)

  Tokens added in B:    1
    --color-accent-pressed: #1D0A4F (used in 3 frames)
  Tokens removed in B:  0
```

Token-level diffs surface design-system-wide changes that show up
across many frames — a single `--accent` shift might cause "47 frames
changed" in the frame-level diff but the root cause is one token.

## Phase 4 — Pixel-level diff (when `--scope` includes frames)

For frames classified as `unchanged` at the structural level but
potentially differing visually (font rendering, child component
changes), run a pixel-level diff:

1. Render both versions of the frame at the same scale.
2. Use `pixelmatch` (or equivalent) to compute the pixel-difference
   ratio.
3. If the ratio exceeds `--threshold`, reclassify as `pixel-diff` and
   include in the output.

This catches drift the structural pass misses — e.g. a font swap that
keeps token names but produces visibly different glyphs, or a
component instance whose internal definition changed.

### Rendering: Pencil's renderer vs open-pencil

By default, Phase 4 uses Pencil's own renderer (Path A or B from
`_context.md`) to produce the per-frame images. When **open-pencil**
is available on PATH, it can serve as an alternative renderer:

```bash
open-pencil export <pen-file> --format png --out <dir>
```

When to prefer each:

- **Pencil's renderer** — when you want fidelity to Pencil's
  display semantics exactly. Useful when the diff is between two
  Pencil-managed `.pen` files and the rendering should match what
  the user sees in the Pencil app.
- **open-pencil's renderer** — when one or both inputs are `.fig`
  files (e.g. comparing a `.pen` against a designer's edited `.fig`
  before round-tripping back via `/product:design:export --from-fig`),
  when running fully offline (no Pencil service reachable), or when
  you want the diff renderer and the Figma export renderer to
  match — using the same engine for both removes a class of "looks
  fine in Pencil, looks different in Figma" surprises.

Pass `--renderer pencil|open-pencil` to override the default. With
no flag, the command picks: Pencil if Pencil MCP/CLI is available
and inputs are `.pen`; open-pencil if either input is `.fig` or if
Pencil is unreachable.

## Phase 5 — Render the diff `.pen`

Build the output `.pen` at `--out`:

> Build a Pencil page named **`Diff: {{a-slug}} → {{b-slug}}`**.
>
> ### Section 1 — Summary card
>
> Header card spanning full width:
> - Files: `{{a.path}}` → `{{b.path}}`
> - Generated: `{{ISO date}}`
> - Counts: `{{added}}` added · `{{removed}}` removed ·
>   `{{moved}}` moved · `{{resized}}` resized · `{{restyled}}`
>   restyled · `{{pixel-diff}}` pixel-diff · `{{unchanged}}` unchanged
>   (hidden by default)
> - Token changes: `{{token-change-count}}`
>
> ### Section 2 — Token diff strip
>
> When `--scope` includes tokens, a horizontal strip showing every
> changed token as a small swatch pair (before / after) with the
> token name and the count of frames affected. Sort by frame-impact
> count descending — biggest blast radius first.
>
> ### Section 3 — Frame-by-frame diff rows
>
> One row per changed frame, ordered by canvas (Atoms → Molecules →
> Organisms → Templates → Pages → others). Each row has three panels:
>
> 1. **Before (A)** — the frame as it appears in A. Mark with a small
>    "A" badge in the corner. If the frame doesn't exist in A
>    (added), render an empty placeholder with "Not in A" caption.
> 2. **After (B)** — the frame as it appears in B. Mark with "B"
>    badge. If removed, "Not in B" placeholder.
> 3. **Diff** — overlay or annotation showing what changed:
>    - For `moved`: arrow from A position to B position, with delta
>      labels (`Δx: +120, Δy: -40`)
>    - For `resized`: A's outline overlaid on B's, with delta labels
>    - For `restyled`: a small token-diff card listing which tokens
>      changed
>    - For `pixel-diff`: pixelmatch heatmap (red = differing pixels)
>      with the diff percentage labeled
>    - For `added` / `removed`: solid green / red bar across the panel
>
> Below each row, a 12px caption with the frame's classification and
> any one-line summary.
>
> ### Section 4 — Anchor links
>
> Sticky left-rail navigation listing all changed frames grouped by
> canvas, with click-to-jump anchors. Reviewers scan the rail to
> find what they care about; the rail is the table of contents for
> the diff.
>
> ### Naming
>
> - Page-level frame: `diff-{{a-slug}}-vs-{{b-slug}}`
> - Section frames: `summary`, `token-strip`, `frame-row-{{n}}`
> - Per-frame panels: `frame-{{slug}}-before`, `frame-{{slug}}-after`,
>   `frame-{{slug}}-diff`

## Phase 6 — HTML report (optional)

Unless `--no-html`, generate a static HTML page that mirrors the
diff `.pen`'s content for browser viewing:

- Same summary card + token strip + frame-by-frame rows
- Frames rendered as PNG screenshots extracted from the `.pen`
- Anchor links work as fragment URLs
- Single self-contained HTML file (inline CSS, no external assets)
- Suitable for posting as a GitHub Pages preview, attaching to a PR,
  or sharing as a Slack link

The HTML report is the **artifact most reviewers will actually open**,
so invest in its readability:

- Mobile-friendly (single column on narrow viewports)
- Print-friendly (each frame row is its own page in print mode)
- Keyboard navigation (j/k to next/prev changed frame)
- Filter controls in the header (toggle by classification:
  added / removed / moved / restyled / pixel-diff)

## Phase 7 — Exit handling

When `--fail-on <type>` is set, exit with non-zero status if any
findings of the specified type exist:

- `--fail-on any` — exits 1 if any change exists. Strictest gate.
- `--fail-on changed` — exits 1 on `restyled`, `resized`, `moved`,
  or `pixel-diff` (excludes `added` / `removed`).
- `--fail-on removed` — exits 1 if anything was removed. Useful for
  preventing accidental deletions.
- `--fail-on added` — exits 1 if anything was added. Useful for
  freezing the design (no new components without explicit approval).

Default exit codes:
- `0` — diff completed, no policy failures.
- `1` — policy failure (when `--fail-on` is set).
- `2` — pre-flight failure (one of the inputs unreadable, etc.).

## Reporting

```
✅ design/.diffs/dashboard-v1-vs-v2.pen
✅ design/.diffs/dashboard-v1-vs-v2.html

Frame changes:
  Added:        3
  Removed:      1
  Moved:        4
  Resized:      2
  Restyled:    12
  Pixel-diff:   6
  Unchanged:  142

Token changes (A → B):
  --accent-500:    #0A84FF → #2E1065   (24 frames affected)
  --font-display:  Inter → Fraunces    (8 frames affected)
  Tokens added: 1, removed: 0

📝 Suggested next:
   Open design/.diffs/dashboard-v1-vs-v2.html in a browser, or
   embed the link in your PR description for review.
```

## CI integration pattern

```yaml
# .github/workflows/design-review.yml
on: pull_request
  paths: ['design/pages/**', 'design/components/**', 'design/foundations/**']
jobs:
  pencil-diff:
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: |
          # Diff every changed .pen against main
          for pen in $(git diff --name-only origin/main...HEAD -- 'design/**.pen'); do
            claude run /product:design:diff "git:origin/main:$pen" "$pen" \
              --html-report ".diffs/$(basename $pen .pen).html" \
              --fail-on removed
          done
      - uses: actions/upload-artifact@v4
        with:
          name: design-diffs
          path: .diffs/
      - uses: actions/github-script@v7
        with:
          script: |
            // Post links to the uploaded HTML reports as a PR comment
            ...
```

The `--fail-on removed` gate prevents accidental deletions; reviewers
opt-in by acknowledging the diff to merge. Other `--fail-on` modes
fit different review philosophies.

## What this command does NOT do

- It does not modify either input `.pen` file. Both inputs are
  read-only.
- It does not auto-merge or reconcile differences. The diff is for
  review; merging is the human's call.
- It does not run interaction tests or visual regression on the
  underlying components — that's `/frameworks:heroui:build-components` territory.
- It does not detect semantic equivalence (e.g. two frames that are
  structurally different but produce visually identical output via
  different token combinations). Equivalence detection is a deeper
  problem; the pixel-diff pass at Phase 4 is the closest
  approximation this command provides.
