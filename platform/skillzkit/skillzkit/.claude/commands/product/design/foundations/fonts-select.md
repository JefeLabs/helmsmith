---
description: Explore Adobe Fonts and other vendors to suggest N candidate font sets (display + body + mono) for a design brief. Surfaces pairing rationale, license, file-size, and vendor trade-offs. Records the chosen set in brand JSON + @theme + foundations/typography.pen — but does NOT auto-build kits, download files, or write @font-face. Setup snippets are printed for the user to apply manually.
argument-hint: [brief text or @path/to/brief.md] [--n 3] [--informed-by <research-json>] [--vendor adobe|google|fontshare|font-squirrel|self-host|any] [--license commercial|free|opensource] [--variable preferred|required|optional] [--max-fonts 2|3] [--multilingual <list>] [--render-candidates] [--lock] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Explore Adobe Fonts and other vendors to suggest N candidate font sets
— display + body + mono — given a brand brief. Surfaces specific font
pairings with their license terms, vendor sources, file-size estimates,
and pairing rationale. Records the chosen set across the three sources
of truth (brand JSON, `@theme` font-family declarations, foundation
`.pen`) so the rest of the design system reads it.

**This command is an exploration and recording tool, not a kit
builder.** It does not download font files, generate `@font-face`
declarations, create Adobe Fonts kits, or modify HTML. After you pick
a set, the command prints copy-paste setup snippets appropriate to the
vendor strategy — you apply them manually so subsetting, licensing,
and version control stay in your hands.

This is the **upstream selection command** for
`/product:design:foundations:typography`, which renders the foundation page from
the persisted choice.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve the brief input (same priority as `colors-select`).
3. Resolve flags:
   - `--vendor` — restrict candidate set to one vendor. Default
     `any` — generates a mixed set across vendors.
   - `--license` — `commercial` (allows paid kits like Adobe Fonts),
     `free` (vendor-free or kit-free for unlimited use), `opensource`
     (SIL OFL or Apache 2.0 only — fully redistributable).
   - `--variable` — variable-font preference. `preferred` (use
     variable when available, fall back to weighted), `required`
     (only suggest variable fonts), `optional` (don't optimize for it).
   - `--max-fonts` — `3` (display + body + mono, default) or `2`
     (display+body, system mono fallback).
   - `--multilingual` — comma list of script families to support
     (`latin-ext, cyrillic, greek, vietnamese, cjk-jp, arabic, etc.`).
     Filters candidates to those with the required subsets.
   - `--informed-by <research-json>` — load competitive research and
     use it to:
     - **Surface category-conventional pairings**: research's
       `industryConventions.typographyPairings` describes dominant
       pairings (e.g. dev-tools lean Inter/JetBrains-Mono; editorial
       leans serif-display + sans-body). Recommend matching pairings
       as defaults; recommend divergent pairings as differentiation.
     - **Tag candidates**: each candidate gets a tag —
       `[category-convention]` when matching, `[differentiation]`
       when intentionally divergent.
     - **Bias `--vendor` defaults**: if research shows the category
       leans heavily on Adobe Fonts vs. Google Fonts, default to
       that vendor unless overridden.

   Research input is advisory — never overrides explicit user input.

## Phase 1 — Brief analysis

Extract dimensions specific to typography:

| Dimension       | Values                                                          |
| --------------- | --------------------------------------------------------------- |
| `tone`          | formal • playful • technical • luxurious • friendly • editorial |
| `industry`      | (same as elsewhere)                                             |
| `voice`         | direct • warm • authoritative • conversational • precise        |
| `reading-volume`| heavy (data, articles) • balanced • light (marketing-only)      |
| `formality`     | corporate • neutral • casual                                    |
| `era`           | classic • modern • futuristic                                   |
| `multilingual`  | the script families parsed from `--multilingual`                |

Print the "Read of the brief" block. Same correction loop as the other
select commands.

## Phase 2 — Vendor strategy decision

Resolve the vendor strategy **before** picking specific fonts, because
the strategy constrains the available pool. Output the strategy as a
named decision the user can accept or override:

| Strategy           | Vendors                          | Pros                                        | Cons                                             | Best for                          |
| ------------------ | -------------------------------- | ------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| `kit-hosted`       | Adobe Fonts, Google Fonts CDN    | No infra; instant updates; large libraries | Third-party DNS dependency; potential FOUT       | Marketing-heavy, fast iteration   |
| `self-hosted`      | Fontshare, Font Squirrel, GitHub | No third-party DNS; offline-capable; CSP-friendly; performance-tunable | Requires hosting + subsetting setup | Production apps, perf-critical    |
| `mixed`            | Adobe for display, self-host body | Distinctive display + safe body            | Two pipelines to maintain                        | Brands with editorial display     |
| `system-stack`     | OS native fonts only             | Zero load; perfect performance              | No brand expression; OS-dependent rendering      | MVPs, perf at all costs           |

The default recommendation depends on the brief's `industry` and
`reading-volume`:

- Production app + heavy reading → `self-hosted` (deterministic perf)
- Marketing site + light reading → `kit-hosted` (fast iteration)
- Editorial / fashion / luxury → `mixed` (display from Adobe; body
  self-host)
- Internal tooling / MVP → `system-stack` (ship faster)

Print the strategy recommendation with reasoning. User confirms or
overrides before Phase 3 picks specific fonts within the strategy.

## Phase 3 — Pairing strategy

A complete font set typically has 2–3 fonts:

- **Display** — large headings, marketing surfaces, hero copy. Can be
  more characterful (a serif, a humanist sans, a geometric grotesque).
  Used at sizes ≥ 24px.
- **Body** — UI text, paragraphs, form labels, table cells. Must be
  neutral and **legible at 13–14px**. Most reading happens here.
- **Mono** — code, tabular numbers, terminal output. Fixed-width by
  definition, designed for tabular reading. Optional for non-technical
  brands.

### Pairing principles

The N candidate sets each apply one of these pairing strategies to
ensure structural diversity:

| Pairing strategy      | Rule                                                                                  | Example                                         |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `superfamily`         | All fonts from the same family (lowest risk; instant harmony)                         | Inter Display + Inter + JetBrains Mono          |
| `serif-sans-contrast` | Serif display, sans body — contrasts personality, harmonizes proportions              | Fraunces + Inter + JetBrains Mono               |
| `sans-sans-contrast`  | Two sans with different personalities — geometric display + humanist body            | Cabinet Grotesk + Inter + JetBrains Mono        |
| `single-voice`        | One sans for everything (display + body), no second face                              | Inter (all weights) + JetBrains Mono            |
| `slab-sans`           | Slab serif display + neutral sans body                                                | Roboto Slab + Inter + JetBrains Mono            |
| `editorial-modern`    | Modern serif display + sans body (high editorial feel)                                | Playfair Display + Inter + JetBrains Mono       |

Within each pairing strategy, pick fonts that satisfy hard rules:

- **X-height harmony**: display + body should have similar x-heights so
  paragraphs flowing into headings feel cohesive (within ~5%).
- **Weight axis coverage**: body needs at least 400, 500, 600, 700;
  display needs at least 600, 700.
- **Numerals**: body should support both proportional and tabular
  numerals (for data-heavy UIs).
- **Italic availability**: body needs true italic (not slanted upright).

## Phase 4 — Vendor library lookup

For each candidate set, resolve specific font names to their vendor
sources. Generate options that span the vendor strategies the user
allowed:

### Adobe Fonts (Typekit) — primary catalog for premium / editorial / classical

- Strengths: ~30,000 fonts, premium serifs, classical faces, robust kit
- License: included in Adobe Creative Cloud subscription; per-domain
- Loading: kit JS or `<link>` import; per-domain limits; ~50KB kit
  overhead before fonts load
- Notable display fonts: Sentinel, Brandon Grotesque, Calluna, Tisa
- Notable body fonts: Acumin, Source Sans, Adobe Caslon

#### Navigating the Adobe Fonts catalog

The Adobe Fonts catalog at fonts.adobe.com exposes a structured filter
taxonomy. Use it deliberately — naive browsing of ~30,000 fonts
produces noise, while a tight filter combo yields a pool of 6–20
genuine candidates that can be ranked by visual fit. The filters group
into five sections:

**Languages and Writing Systems** (hard filter)
Restrict to fonts that include all glyph subsets the brief requires.
For Latin-only briefs, leave default. For multilingual briefs, set
per the `--multilingual` flag (Latin-Ext, Cyrillic, Greek, Vietnamese,
CJK, Arabic, etc.).

**Font Technology**
- `Variable Fonts` — enable when `--variable required`, prefer when
  `--variable preferred`. A variable font carries the full weight
  axis in a single ~25–50KB file vs. 4–7 weight files for static
  delivery.

**Tags** (aesthetic / personality — 26 total, 14 visible by default)
Calligraphic • Clean • Brush Pen • Geometric • Friendly • Rough •
Rounded • Cursive • Art Deco • Luxury • Funky • Fun • Futuristic •
Marker • plus 12 under "View 12 more" (Vintage, Wedding, Stencil,
Elegant, Modern, Decorative, Display, Headline, Blackletter, Gothic,
Stitch, Fashion).

**Classification** (formal type category)
Sans Serif • Serif • Slab Serif • Script • Mono • Hand.

**Properties** (technical features)
- Number of fonts in family (1–25+) — body fonts need ≥4 weights
- Weight: Light / Medium / Bold (visual bucket)
- Width: Narrow / Standard / Wide
- x-Height: Low / Standard / High (high reads better at small sizes)
- Contrast: Low / Moderate / High (high = editorial / luxury feel)
- Italics available (yes/no)
- Standard caps or All Caps only
- Double or Single Story 'a' (single-story = geometric / modern)
- Lining or Oldstyle Figures (lining for data, oldstyle for prose)

#### Brief-to-filter mapping

When Phase 1 parses the brief, the dimensions translate to specific
filter selections on Adobe Fonts. The command applies these
automatically; the table is also documented so the recommendation is
auditable:

| Brief dimension              | Adobe Fonts filter selections                                               |
| ---------------------------- | --------------------------------------------------------------------------- |
| `tone: formal`               | Classification: Serif. Tag: Clean or Luxury.                               |
| `tone: playful`              | Tags: Friendly, Fun, Rounded. Classification: Sans Serif or Hand.          |
| `tone: technical`            | Classification: Sans Serif or Mono. Tag: Clean. Property: x-height High.   |
| `tone: luxurious`            | Tag: Luxury. Classification: Serif. Property: Contrast High.               |
| `tone: editorial`            | Classification: Serif. Property: Contrast High, Oldstyle figures.          |
| `tone: friendly`             | Tag: Friendly, Rounded. Classification: Sans Serif (humanist).             |
| `voice: authoritative`       | Classification: Serif. Property: Contrast High.                            |
| `voice: warm`                | Tag: Rounded, Friendly. Classification: Sans Serif (humanist).             |
| `voice: precise`             | Classification: Sans Serif or Mono. Tag: Geometric, Clean.                 |
| `voice: conversational`      | Tag: Friendly. Classification: Sans Serif (humanist).                      |
| `industry: fintech`          | Classification: Sans Serif. Tag: Clean. Property: Width Standard, x-height High. |
| `industry: health`           | Tag: Rounded, Friendly. Classification: Sans Serif (humanist).             |
| `industry: dev-tools`        | Classification: Sans Serif + Mono. Tag: Clean, Geometric.                  |
| `industry: enterprise-saas`  | Classification: Sans Serif. Tag: Clean. Property: Standard everywhere.     |
| `industry: education`        | Tag: Friendly, Rounded. Classification: Sans Serif (humanist).             |
| `industry: civic`            | Classification: Serif. Tag: Clean.                                         |
| `industry: creative`         | Tag: Art Deco, Luxury, Funky (depending on niche).                         |
| `era: classic`               | Classification: Serif (transitional/old-style). Property: Oldstyle figures. |
| `era: modern`                | Classification: Sans Serif. Tag: Geometric, Clean.                         |
| `era: futuristic`            | Tag: Futuristic, Funky. Classification: Sans Serif (geometric).            |
| `reading-volume: heavy`      | Property: x-height High + Double-story 'a' + Italics + figure style per content (Lining for data, Oldstyle for prose). Family size ≥ 4. |
| `reading-volume: light`      | Display preferences dominate; body filters relaxed.                        |
| `--variable required`        | Font Technology: Variable Fonts ON.                                        |
| `--max-fonts 2` body picks   | Family size ≥ 5 (need a wide weight axis since one face does both display + body roles). |

**Multiple brief dimensions compose.** A "fintech, technical voice,
heavy reading-volume, variable-required" brief produces this combined
filter:
- Classification: Sans Serif, Mono
- Tag: Clean
- Font Technology: Variable Fonts ON
- Properties: x-Height High, Double-story 'a', Italics available,
  Lining figures
- Number of fonts in family: ≥ 4

That set typically yields 6–12 candidates; pick the top 3 by visual
fit and present as Set A.

A "luxury fashion editorial classic" brief produces:
- Classification: Serif
- Tag: Luxury, Calligraphic
- Properties: Contrast High, Oldstyle figures, Italics available
- Family size: ≥ 6

A different ~6–12 candidate pool, ranked separately.

#### Surfacing the filter combo per candidate

Each candidate output (Phase 5) includes a "Filters applied" line so
the user can verify how the candidate was discovered and re-run with
adjustments — `fonts-select` becomes a navigable interface to the
Adobe Fonts catalog rather than a black box.

### Google Fonts

- Strengths: huge library, free, fast CDN, broad multilingual support
- License: SIL OFL (mostly) — fully open
- Loading: `<link>` from `fonts.googleapis.com`, or self-host via
  `google-webfonts-helper`
- Categories: Sans Serif, Serif, Display, Handwriting, Monospace
  (simpler taxonomy than Adobe Fonts — fewer filter axes but the
  same brief-to-category logic applies: technical → Sans Serif/Mono,
  editorial → Serif, etc.)
- Notable display fonts: Playfair Display, Fraunces, DM Serif Display,
  Cabinet Grotesk
- Notable body fonts: Inter, Geist, Manrope, DM Sans, IBM Plex Sans
- Notable mono fonts: JetBrains Mono, Fira Code, IBM Plex Mono

### Fontshare

- Strengths: free for commercial, modern catalog, designer-curated
- License: their own free-for-commercial license
- Loading: their CDN or self-host
- Notable display fonts: Cabinet Grotesk, Switzer, Satoshi, General Sans

### Font Squirrel

- Strengths: free, web-optimized, includes generators
- License: per-font (mostly free for commercial; check each)
- Loading: self-host (they provide complete kits)

### Self-host (no vendor)

- Strengths: no third-party DNS, offline-capable, full control over
  subsetting
- Cost: setup time; needs `@font-face` declarations + asset hosting +
  preloading + subsetting pipeline

For each candidate set, surface:

- The chosen fonts and their vendors
- License terms in plain English ("Free for commercial use, including
  in paid products" or "Requires Adobe CC subscription; per-domain
  licensing")
- File sizes (variable axes, all weights) — both raw and gzipped
- Loading pattern (`<link>`, kit JS, self-hosted `@font-face`)
- FOUT / FOIT mitigation strategy (`font-display: swap` vs
  `optional` vs `block`)

## Phase 5 — Output the recommendation

Print one block per candidate:

```
🔤 Set A — Single Voice (Inter)
   Pairing:        superfamily
   Display:        Inter Display 700
   Body:           Inter 400 / 500 / 600 / 700 (variable)
   Mono:           JetBrains Mono Variable
   Vendor:         Google Fonts (self-hosted) / JetBrains
   License:        SIL OFL (free, open) for both
   File size:      48KB Inter (subset latin), 32KB JetBrains Mono (variable)
   Loading:        <link rel="preload"> + @font-face self-hosted
   Strengths:      Lowest risk, instant harmony, broad multilingual
                   support, perf-friendly, used by GitHub / Figma /
                   Linear / Vercel
   Watch:          Strong association with developer-tool aesthetic;
                   may feel "off" for editorial / luxury brands

🔤 Set B — Editorial Serif (Fraunces + Inter)
   Pairing:        serif-sans-contrast
   Display:        Fraunces (variable: weight, optical, soft)
   Body:           Inter 400 / 500 / 600 / 700 (variable)
   Mono:           JetBrains Mono Variable
   Vendor:         Google Fonts (self-hosted) for all
   License:        SIL OFL (free, open) for all
   File size:      62KB Fraunces, 48KB Inter, 32KB Mono
   Loading:        Preload Inter (body); lazy-load Fraunces (display only)
   Strengths:      Editorial gravitas, modern serif personality, x-height
                   matches Inter
   Watch:          Heavier display load; only show Fraunces for h1/h2,
                   not below

🔤 Set C — Premium Display (Sentinel + Source Sans)
   Pairing:        slab-sans
   Display:        Sentinel (Adobe Fonts)
   Body:           Source Sans 3 Variable (Adobe Fonts)
   Mono:           Source Code Pro (Adobe Fonts)
   Vendor:         Adobe Fonts (all three from one kit)
   License:        Adobe Creative Cloud subscription required
   File size:      Loaded via Adobe kit (~80KB kit + fonts on demand)
   Loading:        Adobe Fonts kit script
   Filters applied (Adobe Fonts):
     Display — Classification: Slab Serif. Tag: Luxury, Editorial.
              Properties: Contrast Moderate, Family ≥ 4.
     Body    — Classification: Sans Serif. Tag: Clean.
              Properties: x-Height High, Italics, Variable Fonts ON,
              Family ≥ 5.
     Mono    — Classification: Mono. Tag: Clean. Italics. Family ≥ 4.
   Strengths:      Premium feel, distinctive slab serif, broad weight
                   coverage, all three fonts from one vendor (single kit)
   Watch:          Adobe CC dependency; per-domain license; potential
                   FOUT if kit script blocks
```

Repeat for all N candidates. Pause for user pick or override. The
**Filters applied** block makes the recommendation auditable — open
fonts.adobe.com, paste the same filters, and you see the same
candidate pool. Tweak any filter (e.g. relax `Contrast` to `Low or
Moderate`), and re-run the command with `--replace` to get a new
candidate set drawn from the broader pool.

## Phase 6 — Render candidates (optional)

If `--render-candidates`, generate
`design/foundations/fonts-candidates.pen`:

> Build a Pencil page named **`Foundations / Fonts / Candidates`**.
> Render N columns side by side, each labeled with the pairing
> strategy. For each column, show the same content rendered in that
> set's fonts:
>
> 1. Hero specimen — single huge `Aa` glyph from Display at 144px
> 2. Display headline — "The {{brand}} mission" at 60/68
> 3. Body paragraph — 80 words of real copy at 16/24 (no lorem)
> 4. UI components — text input with label, button with label, badge,
>    nav-link group at body sizes (14/20)
> 5. Code block — 6 lines of TypeScript at 14/20 mono
> 6. Tabular numerals — a small data table with right-aligned numbers
>    at body-sm
>
> Mark the recommended column with a `--accent` ring + "Recommended"
> Badge. Render once on Light surface and once on Dark.
>
> Below each column, a small spec card listing:
> - Vendor + license summary
> - File-size estimate
> - x-height comparison strip (overlapping `Hxg` glyphs from Display
>   and Body to show the harmony)

After render, screenshot and present inline.

## Phase 7 — Persist the choice

When `--dry-run` is set, this phase does NOT write. Instead it prints
a full diff of what would be written to brand JSON + foundation
manifest + setup snippets. The user reviews and re-runs without
`--dry-run` to commit. See `colors-select.md` for the full dry-run
output format — fonts-select follows the same pattern.

This command is a **selection tool, not a kit builder.** It records
which fonts the user picked across the three sources of truth that
the rest of the design system reads from. It does **not** generate
`@font-face` declarations, download font files, create Adobe Fonts
kits, or set up loading. Those are deliberate manual steps the user
controls — the command surfaces snippets for them in Phase 8.

When confirmed, write atomically to:

### 7a — Brand JSON (`product/.pencil-brand.json`)

```jsonc
{
  // ...existing...
  "fontDisplay":  "Inter Display",
  "fontBody":     "Inter",
  "fontMono":     "JetBrains Mono",
  "fontPairing":  "superfamily",
  "fontVendor":   "google-fonts-self-host",
  "fontLicense":  "SIL OFL",
  "fontVariable": true,
  "fontFallbacks": {
    "display": ["system-ui", "-apple-system", "sans-serif"],
    "body":    ["system-ui", "-apple-system", "sans-serif"],
    "mono":    ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
  }
}
```

The brand JSON intentionally does **not** carry `fontFiles` paths or
an `adobeKitId`. Those depend on the user's hosting setup and are
captured wherever the user keeps them (env vars, `.env.local`, or
inline in the kit `<link>` tag). Keeping them out of brand JSON
keeps the design system source of truth portable across environments.

### 7b — `@theme` font-family lines only

Append the **font-family declarations** to the project's `@theme`
block. These are required for Tailwind v4 to generate `font-display`,
`font-body`, `font-mono` utilities — without them, no font utilities
exist in code. The command writes only the family stacks plus the
type-scale tokens, with an explicit comment that the actual font
sources need separate registration:

```css
@theme {
  /* Typography — written by /product:design:foundations:fonts-select on 2026-05-02 */
  /* Pairing: superfamily | Vendor: google-fonts-self-host                  */
  /* Font sources are NOT registered here — see the "Setup" output for the */
  /* @font-face / kit / CDN snippet appropriate to the chosen vendor.      */

  --font-display: "Inter Display", system-ui, -apple-system, sans-serif;
  --font-body:    "Inter", system-ui, -apple-system, sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Type scale (size / line-height / weight) — populated from foundations/typography.pen */
  --font-display-2xl: 700 72px / 80px var(--font-display);
  --font-display-xl:  700 60px / 68px var(--font-display);
  --font-h1:          700 36px / 44px var(--font-display);
  --font-h2:          600 30px / 38px var(--font-display);
  --font-h3:          600 24px / 32px var(--font-display);
  --font-h4:          600 20px / 28px var(--font-display);
  --font-body-lg:     400 18px / 28px var(--font-body);
  --font-body-md:     400 16px / 24px var(--font-body);
  --font-body-sm:     400 14px / 20px var(--font-body);
  --font-caption:     500 12px / 16px var(--font-body);
  --font-code:        500 14px / 20px var(--font-mono);
}
```

If the user has not yet registered the font sources, the page renders
in the fallback stack (system-ui everywhere) — graceful degradation,
not breakage. The fallback stacks are deliberately chosen to closely
match the chosen font's metrics (similar x-height, weight axis) so
the un-loaded state still looks reasonable.

### 7c — Foundation `.pen` (`design/foundations/typography.pen`)

Trigger regeneration of the foundation page so the visual reference
matches the new font set:

```bash
pencil --in  design/foundations/typography.pen \
       --out design/foundations/typography.pen \
       --prompt "Update the typography foundations page to render the type scale in {{display}} (display) + {{body}} (body) + {{mono}} (mono). Show all 11 type-scale stops with the chosen fonts."
```

### 7d — Atomicity

All three writes (brand JSON, `@theme`, foundation `.pen`) succeed or
none are kept. **No font files are downloaded, no `@font-face` block
is written, no `public/fonts/` directory is created, no Adobe Fonts
kit is created.** Those are the user's manual responsibility per
Phase 8.

## Phase 8 — Setup snippets (printed, not executed)

After persisting the choice, print the snippets the user needs to
**actually load the chosen fonts** in their app. These are
**copy-paste instructions for the user to run themselves**, not files
the command writes. The vendor strategy chosen in Phase 2 determines
which snippet block applies.

### If vendor strategy is `kit-hosted (Adobe Fonts)`

```
🔤 Adobe Fonts setup (manual — this command does NOT create the kit)

   1. Sign in to https://fonts.adobe.com with your Adobe Creative Cloud account.
   2. Create a new Web Project. Name it "{{brand}}".
   3. Add these fonts to the kit (with the exact weights listed):
      - {{display}} — weights {{display-weights}}
      - {{body}}    — weights {{body-weights}}
      - {{mono}}    — weights {{mono-weights}}
   4. Add your domain(s) to the kit's allowed domains list.
   5. Copy the kit's <link> tag into your app's <head>:

      <link rel="stylesheet" href="https://use.typekit.net/YOUR-KIT-ID.css">

   6. (Optional) Add the kit ID to your env vars or app config so it's
      visible in deployment logs:
      NEXT_PUBLIC_TYPEKIT_ID=YOUR-KIT-ID

   Adobe Fonts requires the manual kit-creation step at fonts.adobe.com.
   There is no public API for kit management.
```

### If vendor strategy is `kit-hosted (Google Fonts CDN)`

```
🔤 Google Fonts CDN setup

   Add to your HTML <head>:

   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="https://fonts.googleapis.com/css2?family={{display-encoded}}&family={{body-encoded}}&family={{mono-encoded}}&display=swap"
         rel="stylesheet">

   Google Fonts CDN handles loading. No additional setup needed.
   Trade-offs: third-party DNS dependency, less control over subsetting,
   privacy considerations (Google sees your visitors' IPs).
```

### If vendor strategy is `self-hosted` (any source)

```
🔤 Self-host setup (manual download + @font-face registration)

   1. Download the variable font files:
      - {{display}}: {{display-source-url}}
      - {{body}}:    {{body-source-url}}
      - {{mono}}:    {{mono-source-url}}

      For Google Fonts sources, use https://gwfh.mranftl.com/fonts to
      get optimized .woff2 with subset control.
      For Fontshare, download the .woff2 directly from fontshare.com.
      For Font Squirrel, use their Webfont Generator if you need a
      different subset than the default kit.

   2. Place the .woff2 files in your public/fonts/ directory.

   3. Add @font-face declarations to your CSS (recommend a separate
      fonts.css file imported before globals.css):

      @font-face {
        font-family: '{{body}}';
        font-style: normal;
        font-weight: {{body-weight-range}};
        font-display: swap;
        src: url('/fonts/{{body-filename}}.woff2') format('woff2-variations');
      }
      /* repeat for {{display}} and {{mono}} */

   4. Add preload hints to your HTML <head> (preload body only — display
      and mono load lazily):

      <link rel="preload" href="/fonts/{{body-filename}}.woff2"
            as="font" type="font/woff2" crossorigin>

   This command does NOT download files for you — that keeps subsetting,
   licensing, and version control in your hands.
```

### If vendor strategy is `mixed` (Adobe display + self-host body)

Print both the Adobe Fonts kit instructions for the display font and
the self-host instructions for the body and mono fonts. The two
loading mechanisms coexist without conflict — Adobe's kit serves
display, your `@font-face` rules serve the rest.

### If vendor strategy is `system-stack`

```
🔤 System stack — no setup needed

   The brand JSON and @theme block reference fallback stacks only:
     display: system-ui, -apple-system, sans-serif
     body:    system-ui, -apple-system, sans-serif
     mono:    ui-monospace, SFMono-Regular, Menlo, monospace

   No font files to download, no kit to set up, no CDN dependency.
   Trade-off: zero brand expression in typography. Re-run this command
   if you decide to commit to a typeface later.
```

These snippets are **printed to the terminal**, not written to files.
The user copies them into their setup as appropriate. The command
explicitly will not modify HTML files, CSS files outside `@theme`,
or `public/`.

## Phase 9 — Idempotency

Same shape as `colors-select`:

1. Re-running with no brief change → no-op.
2. Brand-changed → diff and ask.
3. `--replace` forces fresh generation.

## Reporting

```
✅ Recorded font set: Single Voice (Inter)
   Pairing:        superfamily
   Display:        Inter Display
   Body:           Inter (variable, 100–900)
   Mono:           JetBrains Mono Variable
   Vendor strategy: self-hosted (Google Fonts source, SIL OFL license)
   Variable axes:  weight (Inter, Inter Display), weight (JetBrains Mono)

   Recorded in:
   - product/.pencil-brand.json    (font names, vendor, license, fallbacks)
   - app/globals.css @theme block (font-family stacks + type scale)
   - design/foundations/typography.pen (foundation page regenerated)

   NOT generated by this command (manual steps below):
   - @font-face declarations
   - Font file downloads
   - Adobe Fonts kit (if applicable)
   - HTML <link> / <preload> hints

   Performance estimate (when you set up self-hosting):
   - Total: ~128KB compressed (Inter + Inter Display + JetBrains Mono,
     all variable, latin subset only)
   - Add ~50KB per additional script subset (latin-ext, cyrillic, etc.)

⚠️  Watch:
   - Inter has strong "developer aesthetic" associations. If brand
     wants editorial weight, consider Set B (Fraunces + Inter).

📝 Next steps (in order):

   1. Set up font loading per the vendor strategy snippet printed above
      (Phase 8 output). This command intentionally does not auto-build
      kits — you control downloads, hosting, subsetting, and HTML head
      changes.

   2. /product:design:foundations:typography
      Render the foundation reference page in the chosen fonts.

   3. (Optional) Re-run /product:strategy:scaffold --only components
      Rebuild any components that should pick up new font tokens.
```
