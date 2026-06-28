---
description: Pick a color palette for the design system based on a brand brief. Generates N candidate palettes using color theory, runs accessibility checks, and persists the chosen palette to brand JSON + foundations/colors.pen + the project's @theme block.
argument-hint: [brief text or @path/to/brief.md] [--seed <hex>] [--informed-by <research-json>] [--directions monochromatic|complementary|triadic|analogous|split-complementary] [--n 3] [--inspiration material|tailwind|radix|none] [--render-candidates] [--lock] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Decide the design system's color palette — primary, secondary, tertiary,
neutrals, and the four status colors — given a brand brief. Outputs a
fully-resolved palette in HeroUI v3 / Tailwind v4 / `@theme` format,
runs accessibility checks (AA / AAA contrast against backgrounds and
each other), and persists the choice across all three sources of truth
(brand JSON, foundation `.pen`, `@theme` CSS).

This is the **upstream selection command** for `/product:design:foundations:colors`,
which renders the foundation page from the persisted choice.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve the brief input, in this priority order:
   - Inline `$ARGUMENTS` (free text or `@path/to/file.md`).
   - `design/brief.md` if it exists.
   - `tagline`, `industry`, `audience`, `tone` fields from
     `product/.pencil-brand.json`.
   - Otherwise prompt for a 2–3 sentence brief.
3. Detect the **theme framework** for output formatting:
   - Default: **HeroUI v3 + Tailwind v4 `@theme`** (current suite stack).
   - Locate the project's `@theme` source CSS (typically
     `app/globals.css`, `src/app.css`, `styles/globals.css`).
   - If `product/.pencil-brand.json` ever gains a `framework` field for
     future multi-framework support, that wins; for now there's a
     single output path.
4. If `--seed <hex>` is passed, anchor the primary color at that hex.
   Otherwise the brief drives the primary selection.
5. If `--lock` is set, skip review and write directly. Otherwise pause
   between phases for confirmation.
6. If `--informed-by <research-json>` is passed (or
   `design/research/<active-brief-industry>.json` exists), load the
   research. Use it to:
   - **Bias the brief analysis**: the research's
     `industryConventions.colorPalettes` array describes dominant
     palettes in this industry. Surface them to the user as
     "category convention" candidates alongside whatever the brief
     suggests.
   - **Annotate candidates**: each generated palette candidate gets
     a tag — `[category-convention]` if it matches a research
     `industryConventions.colorPalettes` entry, `[differentiation]`
     if it deliberately diverges from those entries.
   - **Suggest a default direction**: if the brief is ambivalent
     about a direction, default to one that matches industry
     conventions when `--strategy match-conventions` is implied,
     or one that diverges when `--strategy differentiate`. (The
     command itself doesn't take `--strategy`; it inherits from
     a project-level config or uses match-conventions as default.)

   Research input is **advisory** — it informs candidate generation
   but never overrides the user's explicit `--seed` or final
   palette choice.

## Phase 1 — Brief analysis

Extract these dimensions from the brief, in addition to the standard
ones from `icons-select`:

| Dimension      | Values                                                              |
| -------------- | ------------------------------------------------------------------- |
| `tone`         | formal • playful • technical • luxurious • friendly • editorial   |
| `industry`     | fintech • health • dev-tools • enterprise-saas • consumer • creative • education • civic |
| `energy`       | calm • balanced • vibrant                                           |
| `saturation`   | muted • balanced • saturated                                        |
| `warmth`       | cool • neutral • warm                                               |
| `density`      | dense (data-heavy) • balanced • generous (marketing-heavy)          |
| `cultural`     | any specific cultural / market color implications (red in finance = loss in US, prosperity in CN; etc.) |

Print the "Read of the brief" block before recommending. Same Socratic
correction loop as `icons-select` — user can correct miscalibration
before the palette gets generated.

## Phase 2 — Direction selection

The N candidate palettes vary along **color-theory direction**, not
just hue. This produces meaningfully distinct options instead of three
nearly-identical palettes:

| Direction              | Description                                                | Best for                      |
| ---------------------- | ---------------------------------------------------------- | ----------------------------- |
| `monochromatic`        | Single hue, varying saturation + lightness                | Minimalist, technical, calm   |
| `complementary`        | Primary + 180° opposite hue                                | Bold, attention-grabbing      |
| `triadic`              | Three hues 120° apart                                      | Balanced, energetic           |
| `analogous`            | Three adjacent hues (within 60°)                           | Harmonious, calm              |
| `split-complementary`  | Primary + two hues 30° either side of the opposite        | Vibrant but less harsh than complementary |

Default direction set for `--n 3` is `[monochromatic, complementary,
analogous]` — these surface the most contrasting palette philosophies.
Override via `--directions`. With `--n 5`, all five directions render.

## Phase 3 — Palette construction

For each direction, build a complete palette:

### Brand colors

- **Accent (primary)** — the brief's seed color or derived per direction
- **Secondary** — derived per direction logic
- **Tertiary** — only included if `density: generous` or industry is `creative`

Each brand color gets a full **50→950 tonal ramp** (11 stops). Use
**OKLCH color space** for perceptual uniformity — naive HSL ramps
produce stops that look uneven at the lightness extremes. The ramp
generation rule:

```
For accent at hex H, in OKLCH (L*, C, h):
  stop 50  → L*=0.97, C reduced to 30%, h preserved
  stop 100 → L*=0.94
  stop 200 → L*=0.86
  stop 300 → L*=0.74
  stop 400 → L*=0.61
  stop 500 → original L* and C (the seed)
  stop 600 → L*=0.45
  stop 700 → L*=0.36
  stop 800 → L*=0.28
  stop 900 → L*=0.21
  stop 950 → L*=0.13, C reduced to 50%
```

Adjust chroma slightly at the extremes (lighter stops desaturate, darker
stops desaturate less) to keep the ramp readable on both light and dark
surfaces.

### Neutrals

A grayscale family tinted per the brief's `warmth`:

- `cool` — a slight blue-ish tint (OKLCH hue ~250°)
- `neutral` — pure gray (no chroma)
- `warm` — a slight orange-brown tint (OKLCH hue ~70°)

Same 50→950 stops. The neutrals carry most of the UI surface burden;
their tint communicates as much brand personality as the accent does.

### Status colors

Four semantic colors with predefined hue ranges (locked because users
have strong cultural associations):

| Token   | Hue range (OKLCH) | Default seed |
| ------- | ----------------- | ------------ |
| success | 130–160°          | `oklch(0.65 0.18 145)` (green) |
| warning | 70–95°            | `oklch(0.75 0.16 85)`  (amber) |
| danger  | 20–35°            | `oklch(0.60 0.22 27)`  (red)   |
| info    | 220–250°          | `oklch(0.65 0.18 235)` (blue)  |

Adjust each status color's L\* and C to harmonize with the brief's
`saturation` and the chosen direction's overall energy. A "calm
muted" palette uses lower-chroma status colors; a "vibrant
saturated" palette uses higher-chroma. Each status gets a 50→950 ramp
the same way.

## Phase 4 — Accessibility check

For every palette, compute:

1. **Primary text on light surface**: `accent-{500..900}` on
   `--background` (`#FFFFFF` for HeroUI). Need ≥ 4.5:1 (WCAG AA) for
   body text, ≥ 3:1 (AA) for large text.
2. **Primary text on dark surface**: `accent-{50..400}` on dark
   `--background`. Same thresholds.
3. **Foreground on accent**: white text on `accent-{500..950}`.
   Identifies the smallest accent stop that's safe for solid-button
   foreground.
4. **Status colors on backgrounds**: each status `{500, 600, 700}` on
   `--background` and on its own `{50, 100}` for tinted alerts.
5. **Adjacent stops in each ramp** — `accent-500` vs `accent-600`
   contrast; if too close, the ramp won't read as a sequence.

Output a contrast matrix per palette:

```
Palette A — Monochromatic (blue)
  accent-500 on white:    7.1:1 ✅ AAA
  accent-700 on white:    11.2:1 ✅ AAA
  white on accent-500:    4.6:1 ✅ AA
  white on accent-600:    5.8:1 ✅ AA
  danger-500 on white:    3.9:1 ⚠️  AA-large only
  ...
```

Palettes that fail any AA-body check on a token actually used in the
component matrix (`accent-500` for primary buttons, etc.) get a
**warning** flag. They're still presentable but the user must
acknowledge before locking.

## Phase 5 — Output the recommendation

Print a concise block per palette:

```
🎨 Palette A — Monochromatic Blue
   Direction:      Monochromatic
   Accent:         #0A84FF (oklch 0.62 0.21 248)
   Secondary:      #66B2FF (lighter shade of accent — same hue)
   Neutrals:       Cool gray (slight blue tint, hue 250°)
   Energy:         Calm
   Use case:       Technical, dev-tools, calm enterprise
   Accessibility:  All AA passes; 1 status color AA-large only
   Pairs with:     Sharp typefaces (Inter, IBM Plex Sans)
```

Repeat for each candidate. Unless `--lock` is set, ask the user to
pick or override.

## Phase 6 — Render candidates (optional)

If `--render-candidates` is passed, generate
`design/foundations/colors-candidates.pen`:

> Build a Pencil page named **`Foundations / Colors / Candidates`** for
> **{{brand}}**. Render N columns side by side, each labeled with the
> direction (`Monochromatic`, `Complementary`, etc.). For each column:
>
> 1. The full accent ramp (11 stops, 96×96 each)
> 2. The neutral ramp
> 3. The four status colors at their default 500 stop
> 4. **Mini component sample** — the same 5 atoms rendered in the
>    palette: a primary button, a card with title + body + button, a
>    chip in the warning color, an alert in danger, a text input.
>    These give a feel for the palette in real component context, not
>    just as swatches.
>
> Mark the recommended column with a `--accent` ring + "Recommended"
> Badge. Render once on Light surface and once on Dark, stacked.
>
> Add a small contrast-check strip at the bottom of each column
> showing AA/AAA pass/fail for the canonical pairings.

After render, screenshot and present inline so the user can confirm or
re-select.

## Phase 7 — Persist to all three sources of truth

When the user confirms (or `--lock`), write atomically to:

### --dry-run behavior

When `--dry-run` is set, Phase 7 does NOT write. Instead, it prints a
full diff of what *would* be written:

```
DRY RUN — no changes will be written.

product/.pencil-brand.json (would change):
   primary:        was #0A84FF      → #0A2E1C
   secondary:      was #66B2FF      → #D4A84F
   colorRamps:     was 9 ramps      → 12 ramps (3 new accents)
   colorDirection: was monochromatic → triadic

app/globals.css @theme block (would change):
   + --color-accent-50:  #F4F1ED
   + --color-accent-100: #E5DDD0
   ... (28 more added or changed)

design/foundations/colors.pen (would regenerate):
   New ramp grid + tokens-table + dark mode pages

product/.pencil-colors.json (would change):
   colorRamps refreshed; tokens count: 117 → 132

To actually write, re-run without --dry-run.
```

The dry-run output gives users full visibility into what's about to
change before any commitment. Use it before any palette change in a
production project where regression risk matters.

### 7a — Brand JSON (`product/.pencil-brand.json`)

```jsonc
{
  // ...existing fields preserved...
  "colorDirection": "monochromatic",
  "primary":   "#0A84FF",
  "secondary": "#66B2FF",
  "tertiary":  null,
  "neutralWarmth": "cool",
  "statusColors": {
    "success": "#16A34A",
    "warning": "#D97706",
    "danger":  "#DC2626",
    "info":    "#0891B2"
  },
  "colorRamps": {
    "accent":  { "50": "...", "100": "...", ..., "950": "..." },
    "secondary": { ... },
    "neutral": { ... },
    "success": { ... },
    "warning": { ... },
    "danger":  { ... },
    "info":    { ... }
  }
}
```

### 7b — `@theme` CSS block

Append to the project's `@theme` source file (locate via the same
detection logic as `build-components.md`):

```css
@theme {
  /* Color palette — written by /product:design:foundations:colors-select on 2026-05-02 */
  /* Direction: monochromatic | Brief: <one-line summary> */

  /* Accent (primary) */
  --color-accent-50:  oklch(0.97 0.02 248);
  --color-accent-100: oklch(0.94 0.04 248);
  --color-accent-200: oklch(0.86 0.08 248);
  --color-accent-300: oklch(0.74 0.13 248);
  --color-accent-400: oklch(0.61 0.18 248);
  --color-accent-500: oklch(0.62 0.21 248);  /* canonical */
  --color-accent-600: oklch(0.45 0.20 248);
  --color-accent-700: oklch(0.36 0.18 248);
  --color-accent-800: oklch(0.28 0.16 248);
  --color-accent-900: oklch(0.21 0.13 248);
  --color-accent-950: oklch(0.13 0.08 248);

  /* Secondary, Tertiary (if present), Neutral, Success, Warning, Danger, Info — same shape */

  /* Semantic surfaces */
  --color-background:      var(--color-neutral-50);
  --color-surface:         #FFFFFF;
  --color-surface-raised:  #FFFFFF;
  --color-surface-overlay: #FFFFFF;
  --color-content-1:       var(--color-neutral-900);
  --color-content-2:       var(--color-neutral-700);
  --color-content-3:       var(--color-neutral-500);
  --color-separator:       var(--color-neutral-200);
  --color-focus-ring:      var(--color-accent-500);
  --color-backdrop:        oklch(0 0 0 / 0.5);
}
```

Tailwind v4 auto-generates `bg-accent-500`, `text-accent-700`,
`border-separator`, etc. utilities from these tokens.

### 7c — Foundation `.pen` (`design/foundations/colors.pen`)

Trigger a regeneration of the foundation page so the visual reference
matches:

```bash
pencil --in  design/foundations/colors.pen \
       --out design/foundations/colors.pen \
       --prompt "Update the color foundations page to reflect the newly-selected palette: direction=<direction>, accent={{accent-hex}}, neutral={{warmth}}, status colors as listed. Render all 7 ramps (accent, secondary, tertiary if present, neutral, success, warning, danger, info) at 11 stops each on Light and Dark sections. Include accessibility contrast badges per stop."
```

### 7d — Atomicity

All three writes succeed or none are kept. If any fails, roll back the
others. The brand JSON, `@theme`, and `colors.pen` must never partially
diverge.

## Phase 8 — Idempotency

Re-running with the same brief:

1. Reads `colorDirection` from brand JSON.
2. If unchanged AND palette tokens haven't been hand-edited, skip
   regeneration and report "no changes."
3. If the brief has changed (new tagline / industry / mood), re-run
   the analysis, surface the diff against the current palette, and
   ask whether to apply.
4. `--replace` forces fresh generation regardless.

## Reporting

```
✅ Wrote palette: Monochromatic Blue
   Updated:
   - product/.pencil-brand.json
   - app/globals.css (@theme block)
   - design/foundations/colors.pen

   Tokens generated: 7 ramps × 11 stops = 77 + 10 semantic surfaces

   Tailwind utilities now available:
     bg-accent-{50..950}, text-accent-{50..950}, border-accent-{50..950}
     bg-neutral-*, bg-success-*, bg-warning-*, bg-danger-*, bg-info-*
     bg-background, bg-surface, bg-surface-raised, bg-surface-overlay
     text-content-1, text-content-2, text-content-3
     border-separator, ring-focus-ring, bg-backdrop

   Accessibility:
     AA (body):       ✅ all canonical pairings pass
     AAA (body):      ✅ accent-700+ on white, white on accent-700+
     AA (large):      ✅ all status colors

⚠️  Watch:
   - danger-500 on white: 4.0:1 (AA-large only). For body danger text,
     prefer danger-600 or higher.

📝 Suggested next:
   /product:design:foundations:colors    # render the foundation page
   /product:strategy:scaffold --only components    # rebuild components with new tokens
```
