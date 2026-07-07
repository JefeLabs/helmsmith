---
description: Generate the brand's downloadable press kit (media kit) — a structured folder of brand logos in multiple formats, brand guidelines extract, executive headshots+bios, fact sheet, recent press release archive index. Output is design/marketing/pr/media-kit/ folder structure ready to deploy to the newsroom page.
argument-hint: [refresh | rebuild] [--include logos,headshots,fact-sheet,brand-guidelines,recent-releases] [--exclude <list>] [--bundle-format zip|folder] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Generate the brand's media kit — a structured folder of press-
ready assets that journalists download from the brand's
newsroom page. The kit answers the question "where do I get
{{Brand}}'s logo / headshots / boilerplate / facts?" in one
place.

A good media kit reduces friction for journalists writing about
the brand. A missing or outdated media kit forces journalists
to ask (slowing their work) or use whatever assets they can
find (often outdated or wrong).

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/pr/_context.md`.
2. Read `product/.pencil-brand.json` for brand identity.
3. Read `design/marketing/pr/boilerplate.json` (required —
   spokesperson registry + current stats source). When missing,
   stop and ask the user to establish first.
4. Read foundation files:
   - `design/foundations/logos.pen` — all logo variants
   - `design/foundations/colors.pen` — brand color tokens
   - `design/foundations/typography.pen` — brand typography
5. Resolve mode:
   - `refresh` (default): incremental update; only refresh assets
     newer than the last build's mtime
   - `rebuild`: full regeneration of all assets
6. Resolve flags:
   - `--include` — which sections to generate. Default `logos,
     headshots,fact-sheet,brand-guidelines,recent-releases`.
   - `--exclude` — sections to skip from the default set
   - `--bundle-format zip|folder` — output as zip (single
     download) or folder structure (deploy as static assets).
     Default `folder`.
   - `--dry-run` — preview without writing.

## Standard media kit contents

A complete kit typically includes:

```
design/marketing/pr/media-kit/
├── manifest.json                         contents index for the newsroom page
├── README.md                             "How to use these assets" for journalists
├── logos/
│   ├── light-on-dark/
│   │   ├── full-color.{svg,png,pdf}     primary brand logo
│   │   ├── monochrome-white.{svg,png}   for dark backgrounds
│   │   └── icon-only.{svg,png}          mark without wordmark
│   ├── dark-on-light/
│   │   ├── full-color.{svg,png,pdf}
│   │   ├── monochrome-black.{svg,png}
│   │   └── icon-only.{svg,png}
│   └── usage-guidelines.md              do/don't for logo use
├── headshots/
│   ├── jane-doe-ceo/
│   │   ├── high-res.jpg                 print-quality (2400px wide+)
│   │   ├── web-res.jpg                  web-quality (1200px wide)
│   │   └── square-crop.jpg              for social/sidebar use
│   └── ... (per spokesperson in registry)
├── fact-sheet.{pdf,md}                   brand facts in one document
├── brand-guidelines-extract.{pdf,md}     core brand identity for press use
├── product-screenshots/                  optional: when brand has visual product
│   └── ...
└── recent-releases/                      latest 6-12 press releases archived
    ├── index.md                          chronological list with summaries
    └── individual release links to /marketing/pr/releases/
```

## Phase 1 — Logos

Walk `design/foundations/logos.pen`, extract every logo variant,
render in three formats per variant:

- **SVG** — vector, scales infinitely, smallest file size,
  best for digital use
- **PNG** — raster with transparent background, broadly
  compatible, two resolutions: web (300px tall) + high-res
  (1500px tall)
- **PDF** — vector embedded in PDF, preferred for print
  publications

Required variants (when present in the design system):

| Variant                        | Use case                                    |
| ------------------------------ | ------------------------------------------- |
| Full-color light-on-dark       | Brand palette logo for dark backgrounds     |
| Full-color dark-on-light       | Brand palette logo for light backgrounds    |
| Monochrome white               | When color isn't possible (single-color print, dark bg) |
| Monochrome black               | When color isn't possible (single-color print, light bg) |
| Icon-only (mark without wordmark) | Avatars, favicons, social profile images |

When a variant doesn't exist in the design system, flag in the
report — most brands have at least the first four; icon-only is
optional but commonly expected.

Generate `logos/usage-guidelines.md`:

```markdown
# {{Brand}} Logo Usage Guidelines

## Do
- Use the SVG version when possible for crisp scaling
- Maintain clear space equal to the height of the wordmark
  on all sides
- Use the appropriate variant for the background color

## Don't
- Stretch, skew, or rotate the logo
- Place on busy backgrounds without sufficient contrast
- Recolor the logo outside the provided variants
- Use the icon-only mark to represent the brand in body text
  (use the wordmark)

## Color values
- Primary: {{accent-500.hex}}
- Background dark: {{content-1.hex}}
- ... (from brand JSON)

## Questions
press@{{brand.domain}}
```

## Phase 2 — Headshots

For each spokesperson in `boilerplate.json`'s `spokespeople`
array:

1. Locate the headshot at `headshotPath`
2. Render three versions:
   - `high-res.jpg` — original or 2400px wide minimum (print)
   - `web-res.jpg` — 1200px wide (web articles)
   - `square-crop.jpg` — 1:1 cropped to face (social/sidebar)
3. Generate companion bio file:
   ```
   headshots/<spokesperson-slug>/
     ├── high-res.jpg
     ├── web-res.jpg
     ├── square-crop.jpg
     └── bio.md   (name, title, short bio, long bio, contact)
   ```

When a spokesperson lacks a headshot path or file, flag — the
registry entry may need updating.

## Phase 3 — Fact sheet

Generate `fact-sheet.{pdf,md}` — a single-page document
journalists can grab to get oriented quickly:

```markdown
# {{Brand}} Fact Sheet

## Company
- Legal name: {{brand.legalName}}
- Founded: {{brand.founded}}
- Headquarters: {{brand.headquarters}}
- Offices: {{brand.offices.join(', ')}}
- Website: {{brand.website}}

## What we do
{{brand.category}} for {{brand.audience}}.

{{brand.boilerplateText}}

## Current stats (as of {{currentStats.lastUpdated}})
- Customers: {{currentStats.customerCount}}
- Funding raised: {{currentStats.fundingTotal}}
- Headcount: {{currentStats.headcount}}

## Leadership
{{for each spokesperson in registry:}}
- {{name}}, {{title}}: {{bioShort}}

## Recent milestones
{{from recent press releases:}}
- {{date}}: {{headline}}

## Press contact
{{mediaContact.name}}
{{mediaContact.title}}
{{mediaContact.email}}
{{mediaContact.phone}}
```

The PDF version uses brand-styled typography and the brand logo
in the header.

## Phase 4 — Brand guidelines extract

Generate a press-friendly extract from the design system —
**not** the full brand guidelines, which are typically internal
or partner-facing. The press extract covers what journalists
need:

```markdown
# {{Brand}} Brand Identity (Press Reference)

## Name
- Always written as **{{brand.displayName}}**
- Capitalization: {{from .pencil-editorial.json terminology}}
- Pronunciation: {{from boilerplate if specified}}

## Logo
See `logos/` folder for usage guidelines and downloadable assets.

## Colors
- Primary brand: {{accent-500.hex}}
- ... (top 3-5 brand colors)

## Tagline
{{brand.tagline}}

## What we are
{{brand.category}} for {{brand.audience}}.

## What we are not
{{from brand JSON when explicit positioning includes "we're not X"}}

## How to refer to us
- First reference: full name "{{brand.legalName}}" or
  "{{brand.displayName}} ({{brand.legalName}})"
- Subsequent references: "{{brand.displayName}}"
- Never abbreviate to "{{abbreviation if explicitly disallowed}}"

## Press contact
{{mediaContact}}
```

This is the document that prevents "Acme Inc." being written
as "ACME" or "acme" by journalists who didn't know.

## Phase 5 — Product screenshots (optional)

When the brand has a visual product (most B2B SaaS, consumer
apps, design tools), include a small set of product screenshots
journalists can use:

- 2-4 hero screenshots showing the product's main interface
- Each at high-res (2400px wide+)
- Each with descriptive filename + alt-text companion

Skip this section for brands without visual products (services
businesses, B2B with no public UI, etc.).

## Phase 6 — Recent releases archive

Walk `design/marketing/pr/releases/` for recent releases. Build
`recent-releases/index.md`:

```markdown
# Recent Press Releases

## 2026

### May 15, 2026
**Acme launches saved searches for engineering teams to cut hours from weekly workflow**
[Full release](https://acme.com/newsroom/saved-searches-launch) ·
[PDF](releases/saved-searches-feature-launch-q2-2026.pdf)

### April 10, 2026
**Acme raises $20M Series B led by Acme Ventures**
[Full release] · [PDF]

### ... (continue chronologically, last 6-12 releases)
```

For each, link to:
- The newsroom page URL (canonical, when published)
- A PDF version of the release in the kit (so journalists who
  download the kit have the releases offline)

Older releases archive on the newsroom page only; the kit
includes only recent ones to keep it focused.

## Phase 7 — Manifest + README

`manifest.json` indexes the kit contents for the newsroom page
to render dynamically:

```jsonc
{
  "version": 1,
  "lastBuilt": "2026-05-02T18:00:00Z",
  "logos": [
    { "variant": "light-on-dark-full-color", "files": ["svg", "png", "pdf"], "path": "logos/light-on-dark/full-color" },
    // ...
  ],
  "headshots": [
    { "spokesperson": "jane-doe", "name": "Jane Doe", "title": "CEO and Co-founder", "files": ["high-res.jpg", "web-res.jpg", "square-crop.jpg"] }
  ],
  "factSheet": { "pdf": "fact-sheet.pdf", "md": "fact-sheet.md" },
  "brandGuidelinesExtract": { "pdf": "brand-guidelines-extract.pdf", "md": "brand-guidelines-extract.md" },
  "productScreenshots": [...],
  "recentReleases": [
    { "slug": "saved-searches-feature-launch-q2-2026", "date": "2026-05-15", "headline": "..." },
    // ...
  ],
  "totalSize": "47.3 MB",
  "downloadFormats": ["folder", "zip"]
}
```

`README.md` greets journalists with the kit's contents and
contact info:

```markdown
# {{Brand}} Press Kit

Welcome to {{Brand}}'s press resources. This folder contains
brand logos, executive headshots, fact sheet, and recent press
releases.

## Quick links

- [Logos](logos/) — SVG, PNG, PDF in light/dark variants
- [Headshots](headshots/) — Bios + photos for executives
- [Fact sheet](fact-sheet.pdf) — One-page brand overview
- [Recent releases](recent-releases/index.md) — Chronological archive

## Press contact

For interview requests, embargo offers, or questions:

{{mediaContact.name}}
{{mediaContact.title}}
{{mediaContact.email}}
{{mediaContact.phone}}

## About {{Brand}}

{{boilerplateText}}

---

Last updated: {{lastBuilt}}
Built by Acme's marketing team using the Pencil suite.
```

## Bundle (optional)

When `--bundle-format zip`, package the entire kit as a single
zip:

```
design/marketing/pr/media-kit/{{brand-slug}}-press-kit-{{date}}.zip
```

Folder format leaves the kit as a directory (deploy directly to
the newsroom page or CDN).

## Reporting

```
✓ Media kit generated: design/marketing/pr/media-kit/

Mode:           refresh (incremental)
Format:         folder

Contents:
  ✓ Logos:             6 variants × 3 formats = 18 files
  ✓ Headshots:         2 spokespeople × 3 versions = 6 files
                       + 2 bio.md files
  ✓ Fact sheet:        fact-sheet.pdf, fact-sheet.md
  ✓ Brand extract:     brand-guidelines-extract.pdf, brand-guidelines-extract.md
  ⚠ Product screens:   skipped — no screenshots in design/foundations
  ✓ Recent releases:   8 releases archived (last 12 months)

Manifest:       manifest.json (47.3 MB total)
README:         README.md (journalist-facing intro)

Action items:
  1. Review logos/usage-guidelines.md — verify do/don't list
     reflects actual brand standards
  2. Review fact-sheet for accuracy of current stats
  3. Verify spokespeople bios are current
  4. Deploy folder to newsroom page (or CDN)
  5. Update boilerplate.json's currentStats if any are stale
  6. Companion: /product:design:templates:newsroom to render the
     newsroom page that hosts this kit
```

## Idempotency

`refresh` mode regenerates only changed assets (mtime-based).
`rebuild` regenerates everything.

When `boilerplate.json` is updated, run `refresh` to propagate
changes. When `design/foundations/logos.pen` changes, refresh
also propagates new logo variants.

## What this command does NOT do

- **Does not deploy the kit.** The kit is built locally; deploy
  to the newsroom page or CDN via the team's existing pipeline.
- **Does not generate the newsroom page.** Use
  `/product:design:templates:newsroom`. The kit becomes content the
  newsroom page links to.
- **Does not photograph headshots.** Headshot photography is
  human work; the command renders existing files into the kit's
  expected sizes.
- **Does not write spokesperson bios.** Bios are authored once
  in `boilerplate.json` and reused. The command pulls them.
- **Does not handle internationalized assets.** Multi-language
  press kits would need per-locale boilerplate + translation
  workflow; out of scope.
- **Does not auto-track which journalists downloaded the kit.**
  Download tracking happens at deploy layer (CDN analytics, etc.).
