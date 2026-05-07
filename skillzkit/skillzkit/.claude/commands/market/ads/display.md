---
description: Generate display network ads — image-based creative across Google Display Network, programmatic networks (DV360, The Trade Desk, StackAdapt), and direct publisher buys. Produces multi-frame .pen with each IAB-standard ad unit as a frame, plus rendered assets (HTML5 or static) packaged for upload.
argument-hint: <campaign-slug> [--mode performance|brand] [--units <list>] [--format html5|static] [--audience <subset>] [--landing <url-or-pen-path>] [--informed-by <brief-slug>] [--cta-style soft|direct|urgent] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate display network ads. Display ads are visual-first, with
copy in supporting role: a strong image and a 4-7 word headline
do most of the work; the body copy (when shown) and CTA are
secondary. The discipline is **stopping the scroll** in 1-2
seconds.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/ads/_context.md`, `product/.pencil-tone.json`, and
   (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json` for visual identity.
3. Resolve inputs:
   - First positional: campaign slug.
   - `--mode performance|brand` — default `performance`.
   - `--units <comma-separated>` — IAB ad units to produce.
     Default set covers the most-bought sizes:
     `300x250,728x90,300x600,160x600,320x50,970x250`. Full IAB
     standard list documented below.
   - `--format html5|static` — `html5` for animated/interactive;
     `static` for image-only. Default `static` (broader
     compatibility; smaller file sizes).
   - `--audience <subset>` — channel audience (translated to
     platform-specific targeting at submission).
   - `--landing <url-or-pen-path>` — landing destination.
   - `--informed-by <brief-slug>`.
   - `--cta-style soft|direct|urgent` — default `direct`.

## IAB standard ad units

The Interactive Advertising Bureau (IAB) defines standard ad-
unit sizes that publishers and ad networks support universally.
Designing to these sizes maximizes inventory and minimizes
rejection.

**Most common sizes (default set):**

| Unit            | Position           | Notes                                     |
| --------------- | ------------------ | ----------------------------------------- |
| **300x250**     | Medium Rectangle   | The most-bought unit; appears in-content  |
| **728x90**      | Leaderboard        | Top-of-page, desktop                      |
| **300x600**     | Half Page          | Sidebar, high engagement                  |
| **160x600**     | Wide Skyscraper    | Sidebar, desktop                          |
| **320x50**      | Mobile Leaderboard | Mobile top/bottom banner                  |
| **970x250**     | Billboard          | Premium top-of-page, desktop              |

**Less common but useful:**

| Unit            | Position           | Notes                                     |
| --------------- | ------------------ | ----------------------------------------- |
| **336x280**     | Large Rectangle    | Older format; less inventory              |
| **970x90**      | Large Leaderboard  | Wide top-of-page                          |
| **300x100**     | Mobile Sidebar     | Less common                               |
| **120x600**     | Skyscraper         | Older, narrower than 160x600              |
| **468x60**      | Banner             | Legacy; very low inventory                |

**Native ad responsive sizes** (when targeting native networks):
multiple sizes get auto-generated from a base creative. The base
creative is typically 1200x628 (matching social sharing card
size) or 1200x675 (16:9).

**Currency disclaimer**: IAB occasionally introduces new units
and deprecates old ones. The 2024+ IAB Standard Ad Unit
Portfolio is the canonical source. Verify before specing
unusual sizes.

## File size + format constraints

Each ad unit has format-specific limits:

- **Static (.jpg, .png, .gif)**: typically 150KB max per unit;
  some networks accept up to 200KB
- **Animated GIF**: same size limit; total animation duration
  capped (typically 15s); animation should be polite (no
  flashing more than 3x/sec — accessibility)
- **HTML5**: 200KB initial load + 2.2MB total (Google's spec;
  others vary). Rendered as a zip file with HTML, CSS, JS,
  assets, and a clickTag for click tracking.

The `--format html5` option produces HTML5-bundled creative;
`--format static` produces image files. Most performance display
buys use static today (faster load, simpler tracking, lower
rejection). HTML5 is reserved for premium placements where
animation or interactivity is the strategy.

## Pre-flight checks specific to display

Before generating, verify:

- Brand JSON has the necessary visual assets — logo (light + dark
  variants), brand colors, typography stack
- The campaign's value proposition is concrete enough for visual
  treatment ("save searches" is concrete; "be more productive"
  is too abstract for display)
- The user has a landing page in mind (display ads to homepage
  perform poorly; specific landing pages required)

## Phase 1 — Determine creative direction

Display ads succeed or fail on the visual. Before designing
specific units, establish creative direction:

- **Hero imagery**: feature screenshot, animated product shot,
  illustration, photo, or pure-typographic. Each has different
  tradeoffs:
  - **Feature screenshot**: highest specificity; works when
    feature is visually distinct; can feel busy at small sizes
  - **Animated product shot** (HTML5): high engagement; production
    cost is higher; requires HTML5 format
  - **Illustration**: brand-distinctive; less specific; works
    better for brand mode than performance
  - **Photo**: human-centered; risks looking like stock unless
    custom; performs well for consumer brands, less for B2B
  - **Pure-typographic**: clean; relies on copy; works best at
    larger units (970x250, 300x600); fails at small (320x50)
- **Color treatment**: brand-accent-led (single color dominant),
  full brand palette, or restrained (mostly neutral with one
  accent moment)
- **Headline cadence**: feature-led, benefit-led, curiosity-
  led, or brand-led
- **CTA prominence**: visually distinct button (best for
  performance), text-only "Learn more" (best for brand), or
  no explicit CTA (relies on whole-ad clickability)

The user picks direction (or hybrids two) before unit-by-unit
generation begins. Wrong direction with great execution loses
to right direction with mediocre execution.

## Phase 2 — Generate per-unit designs

For each requested ad unit, generate a frame in the campaign's
multi-frame `.pen` file. Each frame is exactly the unit's
dimensions:

```
design/marketing/ads/display/launch-saved-searches-q2-2026.pen

Frames (one per ad unit):
  ├── 300x250 Medium Rectangle
  ├── 728x90  Leaderboard
  ├── 300x600 Half Page
  ├── 160x600 Wide Skyscraper
  ├── 320x50  Mobile Leaderboard
  └── 970x250 Billboard
```

Each frame applies the chosen creative direction adapted for the
unit's aspect:

- **300x250 (Medium Rectangle)**: nearly square; most flexible.
  Typically: image left, headline + CTA right.
- **728x90 (Leaderboard)**: extremely wide. Logo + headline +
  CTA in a row; visual minimal.
- **300x600 (Half Page)**: tall. Vertical hierarchy:
  headline top, image middle, CTA bottom.
- **160x600 (Wide Skyscraper)**: very tall and narrow. Vertical
  stack only; copy must be very tight.
- **320x50 (Mobile Leaderboard)**: tiny. Logo + 4-word
  headline + CTA. No body copy fits.
- **970x250 (Billboard)**: wide and tall. Most production
  budget; heroic visual + tight copy.

The `.pen` file's frame names match the unit dimensions exactly:
`300x250`, `728x90`, etc. Pencil's MCP / CLI generates the
frames following the chosen creative direction:

```bash
pencil --out design/marketing/ads/display/launch-saved-searches-q2-2026.pen \
       --prompt "<embedded prompt: display ad campaign for saved-searches launch,
                 6 frames at IAB sizes (300x250, 728x90, 300x600, 160x600, 320x50, 970x250),
                 voice from .pencil-tone.json modulated -0.5 warmth +1.0 energy -0.5 complexity,
                 hero treatment: feature screenshot,
                 brand-accent-led color treatment,
                 benefit-led headline 'Stop re-typing the same searches',
                 CTA 'Try saved searches' visually distinct button,
                 each frame layout adapted for its aspect>"
```

## Phase 3 — Headline + body + CTA per unit

Per unit, generate copy fitting the available real estate:

- **Headline**: 4-7 words for most units; 3-4 for 320x50 mobile
  leaderboard; up to 10 for 970x250 billboard
- **Body** (when present): 1 sentence, 8-15 words, on units
  with vertical room (300x250, 300x600, 970x250, 160x600). Skip
  on 728x90 and 320x50 — no room.
- **CTA**: 2-3 words ("Try free", "Get started", "Learn more",
  "Try saved searches"). Same CTA across all units in the
  campaign — consistency aids brand recall.

Apply voice modulation per `market/ads/_context.md` performance-
display row: warmth -0.5, energy +1.0, complexity -0.5. Display
ads are short — voice expression is in the imagery, not the
copy.

Example for the launch-saved-searches campaign:

```
ALL UNITS (consistent across the set):
  CTA: "Try saved searches"

PER-UNIT COPY:

  300x250 Medium Rectangle:
    Headline: "Stop re-typing searches"
    Body:     "Save filters once, reuse forever."

  728x90 Leaderboard:
    Headline: "Save searches in seconds"
    Body:     (none — no room)

  300x600 Half Page:
    Headline: "Searches you save, alerts you trust."
    Body:     "Filter once. Save it. Get notified when new matches arrive."

  160x600 Wide Skyscraper:
    Headline: "Save searches"
    Body:     "Reusable filters, anytime."

  320x50 Mobile Leaderboard:
    Headline: "Save your searches"
    Body:     (none)

  970x250 Billboard:
    Headline: "The searches you save become your shortcuts."
    Body:     "Reusable filters, smart alerts, zero re-typing."
```

## Phase 4 — Render assets

Generate the deliverable assets per unit, packaged for upload:

**Static format**:
- Each frame exported as `.jpg` or `.png` per unit dimensions
- File size verified under 150KB
- Brand color profile preserved
- Output: `design/marketing/ads/display/<campaign-slug>/300x250.jpg`,
  `728x90.jpg`, etc.

**HTML5 format**:
- Each frame exported as an HTML5 zip per Google Web Designer
  conventions (or whichever HTML5 toolchain the team uses)
- Initial load + total size verified
- clickTag implemented for click tracking
- Output: `design/marketing/ads/display/<campaign-slug>/300x250.zip`,
  etc.

For HTML5, animation should:
- Use polite-load (assets load progressively, not all at once)
- Cap total animation duration at 15s (Google's hard cap on
  many networks)
- Avoid epilepsy-trigger flashing (no >3 flashes/sec)
- Be accessible (sufficient contrast for any text overlays)

## Phase 5 — Package + metadata

Produce a campaign zip with all rendered assets:

```
design/marketing/ads/display/launch-saved-searches-q2-2026/
├── 300x250.jpg
├── 728x90.jpg
├── 300x600.jpg
├── 160x600.jpg
├── 320x50.jpg
├── 970x250.jpg
└── README.txt    (campaign meta — units, file sizes, dates)
```

Metadata JSON per `market/ads/_context.md` schema, with
display-specific section:

```jsonc
{
  "kind": "ad",
  "subType": "display",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "platform": "google-display-network",   // or programmatic-direct, etc.
  "mode": "performance",
  "display": {
    "format": "static",                    // static | html5
    "creativeDirection": "feature-screenshot-with-accent",
    "headlineAngle": "benefit",
    "ctaStyle": "direct",
    "units": [
      {
        "size": "300x250", "name": "Medium Rectangle",
        "asset": "design/marketing/ads/display/launch-saved-searches-q2-2026/300x250.jpg",
        "fileSize": 87340,
        "headline": "Stop re-typing searches",
        "body": "Save filters once, reuse forever.",
        "cta": "Try saved searches"
      },
      // ... per-unit entries
    ]
  },
  "audience": { ... },
  "creative": { ... },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "-0.5", "energy": "+1.0", "complexity": "-0.5" }
  },
  "compliance": { ... },
  "performance": { ... },
  "landing": { ... }
}
```

## Reporting

```
✓ Display ad campaign generated: launch-saved-searches-q2-2026

Design source:  design/marketing/ads/display/launch-saved-searches-q2-2026.pen
Asset bundle:   design/marketing/ads/display/launch-saved-searches-q2-2026/
                ├── 300x250.jpg   (87 KB)
                ├── 728x90.jpg    (62 KB)
                ├── 300x600.jpg   (104 KB)
                ├── 160x600.jpg   (71 KB)
                ├── 320x50.jpg    (38 KB)
                └── 970x250.jpg   (148 KB)

Format:         static (.jpg)
Units:          6 (default IAB set)
Total size:     510 KB across all units
Voice:          Confident Mentor (warmth -0.5, energy +1.0, complexity -0.5)

CTA:            "Try saved searches" (consistent across all units)
Creative:       feature-screenshot-with-accent direction

Compliance:
  All units under 150KB (within static-display network limits)
  No FTC disclosure required (display contextually obvious)
  No industry regulation flagged

Action items:
  1. Review .pen file for cross-unit consistency
     (open design/marketing/ads/display/launch-saved-searches-q2-2026.pen)
  2. Verify message-match with landing page:
     /market:ads:landing audit launch-saved-searches-q2-2026
  3. Submit to ad network (Google Ads / DV360 / etc.)
  4. Monitor CTR per-unit after 1-2 weeks; rotate
     out underperforming units, scale up winners
```

## Idempotency

Re-running with the same campaign-slug overwrites both `.pen`
source and rendered assets. For variant tests, use distinct
slugs.

## What this command does NOT do

- **Does not auto-render HTML5 from .pen.** HTML5 export is
  Google Web Designer / specialized tool work; the command
  produces the design source and metadata, with HTML5 packaging
  handled by the team's chosen tool.
- **Does not test against ad-network policies in real-time.**
  Each network's policy review happens at submission. The
  command flags known policy-relevant fields in metadata for
  team review before submission.
- **Does not handle responsive display ads.** Google's responsive
  display ads accept single base assets and auto-generate sizes;
  that's a separate (lower-control) format. This command
  produces fixed-size IAB-standard creative for higher-control
  buys.
- **Does not handle native ad creative.** Native ads (sponsored
  content matching publisher format) have different rules;
  warrants its own command if added.
- **Does not optimize for specific networks beyond IAB.**
  Programmatic networks (DV360, TTD, StackAdapt) accept IAB-
  standard creative; non-standard variations need network-
  specific handling.
