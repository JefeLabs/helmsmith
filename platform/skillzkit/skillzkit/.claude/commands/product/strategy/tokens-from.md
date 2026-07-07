---
description: Extract design tokens from arbitrary input (screenshot, live URL, or Figma file) to seed a foundation. Surfaces colors, typography, spacing, and radius values; produces a draft brand JSON section the user can review and apply via colors-select / fonts-select. Does NOT auto-commit tokens to the design system.
argument-hint: <screenshot-path|url|figma-url|fig-file|pen-file> [--target colors|fonts|spacing|radius|all] [--n-colors <count>] [--n-fonts <count>] [--out <path>] [--apply-to colors-select|fonts-select|brand-json|none] [--accumulate-into-research <industry-slug>] [--competitor-name <name>]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Extract design tokens from a reference — a screenshot of an existing
product, a live URL, or a Figma file — and produce a draft set of
foundation tokens (colors, typography, spacing, radius). Useful when:

- Migrating an existing product into the Pencil design system
- Seeding a new project with tokens drawn from a reference design
  the user wants to match
- Auditing token consistency across a design system that wasn't built
  with one (extract from multiple screenshots, look for outliers)

This command is a **token-extraction tool, not an applier**. It
proposes draft tokens for the user to review; applying them to the
design system is a deliberate next step via `colors-select`,
`fonts-select`, or direct brand JSON edit. The command never silently
overwrites existing tokens.

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Validate the input:
   - **Screenshot**: file path ending in `.png`, `.jpg`, `.jpeg`, or
     `.webp`. Multiple screenshots can be passed as a comma list for
     consistency-audit mode.
   - **URL**: any `https://` URL. The command renders the page via a
     headless browser (Playwright preferred) and extracts from the
     rendered DOM + computed styles. Some sites block headless
     browsers; surface the failure clearly if so.
   - **Figma URL**: a `figma.com/file/...` or `figma.com/design/...`
     URL. Requires Figma MCP if available, otherwise prompts the
     user to provide a personal-access-token via env var.
3. Resolve flags:
   - `--target` — which token categories to extract. Default `all`.
     Combinations like `colors,fonts` are accepted.
   - `--n-colors <count>` — how many distinct colors to surface.
     Default `8` (typical for a brand-color set + neutrals + a couple
     of statuses). Max `20`.
   - `--n-fonts <count>` — distinct font families to surface. Default
     `3` (display + body + mono). Max `5`.
   - `--out <path>` — JSON output path for the draft tokens. Default
     `design/.tokens-draft-<input-slug>.json`.
   - `--apply-to <command>` — automatically pipe the draft as input
     to the named follow-on command:
     - `colors-select` → runs `/product:design:foundations:colors-select
       --seed-from <draft.json>`
     - `fonts-select` → similar for fonts
     - `brand-json` → directly merges into `product/.pencil-brand.json`
       (with confirmation prompt)
     - `none` (default) → just writes the draft, no follow-on.

## Phase 1 — Capture the input

The capture mechanism varies by input type:

### Screenshot

1. Open the image file. Verify it loads (valid format, non-zero
   dimensions).
2. If multiple screenshots are passed, process them sequentially and
   merge results (deduplicating overlapping tokens).
3. No additional capture needed — the image *is* the data.

### URL

1. Launch a headless browser (Playwright preferred; Puppeteer
   fallback).
2. Navigate to the URL. Wait for `networkidle` or 5s, whichever is
   shorter.
3. Capture two artifacts:
   - **Screenshot** of the viewport at 1440×900 (the canonical
     desktop reference width).
   - **Computed-style harvest**: walk the DOM, for each element pull
     `color`, `background-color`, `font-family`, `font-size`,
     `font-weight`, `line-height`, `padding`, `margin`, `border-radius`,
     `box-shadow`. Record per-element + frequency.
4. The computed-style harvest is more accurate than the screenshot
   for exact token values — the screenshot serves as cross-check.
5. **Headless detection**: some sites (Cloudflare-protected, paywall
   walls, anti-bot) block headless browsers. If detected, fall back
   to screenshot-only mode and warn the user.

### Figma URL

1. Resolve the file key from the URL.
2. Use Figma MCP if available:
   - `figma:get_design_context` for the file or a specific frame
   - Returns structured token information (Figma styles, variables)
3. If MCP not available, use Figma's REST API with a PAT:
   - `GET /v1/files/{file_key}/styles` for styles
   - `GET /v1/files/{file_key}/variables/local` for variables
4. Figma extraction is the most accurate path because tokens are
   already structured — no inference from rendered output needed.

### Local design file (`.fig` or `.pen`)

When the input is a local design file, extraction uses
**open-pencil** for structured analysis. This is the highest-
fidelity mode — the tokens are already structured in the document,
no inference from pixels or DOM required.

Prerequisite: `open-pencil` CLI on PATH (`brew install open-pencil`
or `npm install -g @open-pencil/cli`). If absent, the command falls
back to rendering the file to a screenshot (lower fidelity) and
processing as a screenshot input.

The capture invokes:

```bash
# Variables (typed: COLOR, FLOAT, STRING, BOOLEAN):
open-pencil variables <file> --json

# Color analysis (palette extraction with frequency + role inference):
open-pencil analyze colors <file> --json

# Typography analysis (font families, sizes, weights, line-heights):
open-pencil analyze typography <file> --json

# Spacing analysis (padding/margin/gap clusters with frequencies):
open-pencil analyze spacing <file> --json

# Cluster analysis (grouped values that suggest implicit tokens):
open-pencil analyze clusters <file> --json
```

Each command returns structured JSON. The phase merges them into
the same internal capture format used by other modes:

```jsonc
{
  "source": "competitor.fig",
  "sourceType": "fig",
  "extractedAt": "<ISO>",
  "rawCapture": {
    "variables": { /* from open-pencil variables */ },
    "colors":    { /* from open-pencil analyze colors */ },
    "typography":{ /* from open-pencil analyze typography */ },
    "spacing":   { /* from open-pencil analyze spacing */ },
    "clusters":  { /* from open-pencil analyze clusters */ }
  }
}
```

Why this is the highest-fidelity mode:

- **Variables are already typed.** A `COLOR` variable in `.fig`
  carries its name (`Accent/500`), its raw value, and any aliases.
  No k-means inference, no OCR, no DOM walking.
- **Token roles are inferable from variable names.** A variable
  named `Accent/500` is the accent ramp's 500 stop; a variable
  named `Heading/H1` is the H1 typography. Phase 5's confidence
  scoring lifts to ~0.95+ for variable-driven extraction.
- **Cluster analysis surfaces implicit tokens.** Spacing values
  that cluster around 4 / 8 / 16 / 24 suggest a 4px-base scale even
  if the source file didn't formally declare one.
- **Display-P3 colors preserved.** Wide-gamut color values pass
  through without sRGB clipping that screenshot extraction would
  silently apply.

For `.pen` files specifically, this is also the recommended way to
extract tokens from your own historical Pencil work — e.g.
"capture the tokens used in our v1 brand from `archive/v1.pen`."

## Phase 2 — Extract colors

For each capture mode, distinct extraction logic:

### From screenshot

1. **Quantize** the image to a reduced palette using k-means clustering
   in OKLCH space (perceptually uniform). Target `--n-colors * 3` initial
   clusters to give room for filtering.
2. **Filter** the candidate palette:
   - Drop near-white and near-black (those are surface / content,
     not brand colors).
   - Drop low-coverage colors (< 0.5% of pixels) — likely
     anti-aliasing artifacts or photo content.
   - Drop near-duplicates (within ΔE < 5).
3. **Classify** remaining colors:
   - **Saturation > 0.3** → likely brand colors (accent, secondary,
     status). Sort by frequency and take top `--n-colors / 2`.
   - **Saturation < 0.1** → neutrals. Sort by lightness and surface
     the spread (one near-white, mid grays, near-black).
   - **In between** → tinted neutrals. Surface separately.
4. **Generate ramps** for each surfaced brand color (50→950 in OKLCH).

### From URL (computed styles)

1. Aggregate every distinct `color` and `background-color` value
   across the DOM, with frequency counts.
2. Filter and classify the same way as the screenshot path, but using
   exact RGB values from computed styles (no quantization noise).
3. Cross-check against the screenshot pass — colors that appear in
   both are higher-confidence than colors in only one.

### From Figma

1. Pull color styles directly. Each Figma color style maps to a
   candidate token.
2. Pull color variables. Variables → tokens 1:1 (Figma's variable
   model is the closest analog to design tokens).
3. No inference needed — surface the styles/variables as-is.

### Output shape

```jsonc
{
  "colors": {
    "extracted": [
      {
        "hex": "#0A84FF",
        "oklch": "oklch(0.62 0.21 248)",
        "role": "brand",
        "confidence": 0.92,
        "source": "computed-style + screenshot",
        "appearances": 47
      },
      {
        "hex": "#16A34A",
        "oklch": "oklch(0.65 0.18 145)",
        "role": "status-success",
        "confidence": 0.78,
        "source": "computed-style only",
        "appearances": 8
      }
      // ...
    ],
    "ramps": {
      "accent": { "50": "...", "100": "...", ..., "950": "..." }
    },
    "neutrals": {
      "warmth": "cool",  // inferred from neutrals' chroma + hue
      "stops": ["#F8FAFC", "#E2E8F0", "#94A3B8", "#475569", "#1E293B"]
    }
  }
}
```

## Phase 3 — Extract typography

### From screenshot

1. Run **OCR** on the image to identify text regions and approximate
   their bounding boxes.
2. Cluster text regions by **size band** (heading, body, caption) and
   **weight band** (regular, medium, bold) using bounding-box height
   + glyph density heuristics.
3. **Font-family identification is hard from pixels alone.** Use a
   font-recognition service (WhatTheFont API, Adobe Fonts visual
   match, or a simpler glyph-shape heuristic) to propose candidates.
   Surface 2–3 candidates per band with confidence scores; let the
   user pick.

### From URL (computed styles)

1. Aggregate `font-family` declarations across the DOM. Deduplicate
   stacks (`-apple-system, sans-serif` is one stack; surface the
   primary family).
2. For each family, compute the size/weight/line-height combinations
   in use. Cluster into a type scale.
3. The `font-family` value is exact — no recognition needed.

### From Figma

1. Pull text styles directly. Each Figma text style is one type-scale
   step.
2. Surface as-is.

### Output shape

```jsonc
{
  "fonts": {
    "candidates": [
      {
        "family": "Inter",
        "role": "body",
        "confidence": 0.95,
        "weights-seen": [400, 500, 600, 700],
        "sizes-seen": [14, 16, 18, 24],
        "source": "computed-style"
      },
      {
        "family": "Fraunces",
        "role": "display",
        "confidence": 0.88,
        "weights-seen": [600, 700, 900],
        "sizes-seen": [36, 48, 72],
        "source": "computed-style"
      }
    ],
    "typeScale": [
      { "token": "display-2xl", "size": 72, "lineHeight": 80, "weight": 700, "family": "Fraunces" },
      { "token": "h1",          "size": 36, "lineHeight": 44, "weight": 700, "family": "Fraunces" },
      { "token": "body-md",     "size": 16, "lineHeight": 24, "weight": 400, "family": "Inter" }
    ]
  }
}
```

## Phase 4 — Extract spacing and radius

Less interesting visually but useful for system-fidelity migration:

### Spacing

1. From URL: aggregate `padding` and `margin` values across the DOM,
   weighted by usage frequency.
2. Find the **base unit** — the smallest commonly-used value. Most
   design systems use 4px or 8px base.
3. Verify the rest of the values are multiples of the base. Outliers
   indicate either inconsistency in the source or a non-multiplicative
   scale.
4. Surface a proposed scale (`0`, `1`, `2`, `4`, `6`, `8`, `12`, `16`,
   `24`, `32`, `48`, `64`, `96`).

### Radius

1. Aggregate `border-radius` values.
2. Cluster into discrete steps (`none`, `sm`, `md`, `lg`, `xl`, `full`).
3. Surface as proposed `--radius-{step}` tokens.

Skip both for screenshot-only mode (extracting spacing from pixels is
unreliable).

## Phase 5 — Confidence and conflicts

The extracted tokens carry **confidence scores** that reflect:

- **Source quality**: Figma > URL computed-style > URL screenshot > screenshot only
- **Agreement**: tokens appearing in multiple captures (e.g. screenshot + computed-style) get higher confidence
- **Frequency**: tokens used in many DOM elements / many image regions are higher confidence than rare ones

Surface low-confidence tokens (< 0.5) with explicit `[REVIEW]` flags
in the output. Don't auto-include them in proposed ramps or scales.

If the input is **multiple screenshots** and they disagree (different
brand colors across captures), surface the disagreement rather than
averaging:

```
⚠️  Color extraction inconsistency
    Screenshot 1: primary brand color #0A84FF (frequency: 0.32)
    Screenshot 2: primary brand color #2E1065 (frequency: 0.28)

    The screenshots show different brand colors. Possible causes:
    - The product uses different brand colors per surface (light vs
      dark mode, vs marketing vs product)
    - The screenshots are from different time periods (rebrand?)
    - One screenshot is incorrectly labeled

    Recommended: pass screenshots for one consistent surface only,
    or run separately per surface and merge manually.
```

## Phase 6 — Write the draft

Write the draft to `--out` (default
`design/.tokens-draft-<input-slug>.json`) with this structure:

```jsonc
{
  "extractedAt": "2026-05-02T18:42:00Z",
  "input": {
    "type": "url",  // or "screenshot" or "figma"
    "value": "https://..."
  },
  "colors":  { /* Phase 2 output */ },
  "fonts":   { /* Phase 3 output */ },
  "spacing": { /* Phase 4 output, omitted for screenshot-only */ },
  "radius":  { /* Phase 4 output, omitted for screenshot-only */ },
  "summary": {
    "tokensProposed": 24,
    "highConfidence": 18,
    "needsReview":     6,
    "rampsGenerated":  3
  }
}
```

The draft is **never directly applied** to the design system. Even
with `--apply-to brand-json`, the user gets a confirmation prompt
showing what would change before any write.

## Phase 7 — Apply (optional)

When `--apply-to <command>` is set:

### `--apply-to colors-select`

Run `/product:design:foundations:colors-select --seed-from <draft.json>`. The
colors-select command extends to accept this flag — it uses the draft's
extracted accent / secondary as seeds for its candidate generation
(rather than the brief alone).

### `--apply-to fonts-select`

Similarly invokes `/product:design:foundations:fonts-select --seed-from
<draft.json>`.

### `--apply-to brand-json`

Direct merge into `product/.pencil-brand.json` after confirmation.
Only high-confidence tokens (> 0.8) are merged automatically; lower-
confidence ones are listed and require explicit ack:

```
Proposed brand-JSON merge:

High confidence (auto-merge on confirmation):
  primary: #0A84FF
  fontDisplay: Fraunces
  fontBody: Inter

Needs review (require explicit ack):
  status.success: #16A34A   [confidence 0.62]
  status.warning: #D97706   [confidence 0.71]

Continue? Auto-merge high-confidence + flag low-confidence as TBD? [y/N]
```

### `--accumulate-into-research <industry-slug>`

Append the extracted tokens to `design/research/<industry-slug>.json`
as a new entry in `competitorsSurveyed`. This is how tokens-from
runs accumulate into research over time — each invocation against a
new competitor URL adds to the dataset that downstream select
commands consume.

Required: `--competitor-name <name>` to label the entry. The URL
serves as the unique key; if a competitor with the same URL already
exists in `competitorsSurveyed`, the existing entry is **updated**
(re-extracted tokens replace the prior, but other fields like
detected `pages` and `tone` are preserved).

The accumulation flow:

1. Read existing `design/research/<industry-slug>.json` (or create
   skeleton if the file doesn't exist)
2. Build the new competitor entry from this tokens-from extraction:
   ```jsonc
   {
     "name": "<competitor-name>",
     "url": "<input-url-or-source>",
     "tokens": {
       "primary": "...",
       "secondary": "...",
       "fonts": { "display": "...", "body": "...", "mono": "..." },
       "imagery": "<inferred direction>"
     },
     "pages": [],
     "tone": null,
     "imageryDirection": null
   }
   ```
3. Validate the entire file against the research schema
   (`product/design/.product-research-schema.json`) before writing
4. Update the file's `researchedAt` timestamp to now
5. Recompute `patternFrequency` / `templateFrequency` if there are
   `pages` from prior captures (this run only added tokens; pattern
   detection requires the full research command)

The accumulated research file becomes the input for
`/product:design:patterns:select` and `/product:design:templates:select`. Users can
build research one competitor at a time with `tokens-from` instead
of running the full `/product:strategy:research` command in one shot — useful
when surveying competitors over time as they're discovered.

Note: pattern detection (`hero-split-image-right`, etc.) requires
the full `/product:strategy:research` capture flow because it needs page
screenshots and DOM analysis. tokens-from only contributes token
data to research; for full analysis, run
`/product:strategy:research <industry> --update` after accumulating tokens
from several competitors.

## Reporting

```
✅ design/.tokens-draft-<input-slug>.json
   Input: screenshot (3 files)
   Tokens proposed: 24 (high-confidence: 18, needs review: 6)
   Ramps generated: 3 (accent, secondary, neutral)
   Type scale: 8 steps inferred
   Spacing scale: skipped (screenshot input — unreliable)

⚠️  Review items:
   - 2 colors with low confidence (< 0.5): see colors[2..3]
   - 1 font candidate has 3 alternatives — pick before applying

📝 Suggested next:
   /product:design:foundations:colors-select --seed-from design/.tokens-draft-<slug>.json
   /product:design:foundations:fonts-select  --seed-from design/.tokens-draft-<slug>.json

   OR open the JSON, edit values manually, then re-run with --apply-to brand-json.
```

## What this command does NOT do

- It does not commit tokens to the design system. Application is a
  separate step via `--apply-to` or manually.
- It does not generate component implementations from the input. It
  only extracts atomic tokens — palette, type scale, spacing, radius.
- It does not handle motion tokens, shadow tokens, or animation
  curves — those are harder to extract reliably from any input source.
  Adding motion extraction is a future enhancement.
- It does not handle dark-mode detection. If the input is a dark-mode
  surface, the extracted tokens reflect the dark-mode values; users
  intending light-mode tokens should provide a light-mode capture.
- It does not handle multi-language typography correctly. A reference
  using Latin + CJK fonts will surface both candidates without
  knowing which serves which script range — manual review required.

## Edge cases

### "The screenshot is mostly photographic content."

K-means quantization picks up photo colors (skin tones, sky, etc.)
along with brand colors. The frequency filter helps, but if the
screenshot is dominated by photo content, manually crop to a UI
chrome region before passing.

### "The URL renders differently for headless browsers."

Some sites detect headless browsers and serve different content (or
block entirely). Pass the `--user-agent` flag to set a real-browser
UA string; if that fails, fall back to a screenshot you take manually
and pass that.

### "The Figma file has 200 color styles."

Figma files often accumulate stale styles. The command surfaces
*every* style as a candidate, ranked by usage. Use `--n-colors` to
cap the surfaced set to the top N by usage; outliers below that cut
are ignored.

### "I want to extract from a video / screen recording."

Out of scope. Sample stills from the recording manually and pass them
as multi-screenshot input.
