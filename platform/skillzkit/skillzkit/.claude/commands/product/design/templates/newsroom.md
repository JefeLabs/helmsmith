---
description: Generate the newsroom page template — the brand's owned PR surface where press releases archive, the media kit downloads, executives are introduced, and journalists find press contact info. Reads design/marketing/pr/newsroom-content.json (produced by /market:pr:newsroom) for content. Distinct from marketing.md variants because the structure (chronological release archive + media-kit download + executive bios + press contact form) is meaningfully different from blog/about/features pages.
argument-hint: [--release-list-style cards|list|chronological] [--with-form] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/newsroom.pen` — the brand's newsroom
page. Distinct template from marketing.md variants because the
structure differs meaningfully: chronological release archive,
media-kit download CTA, executive bios, press contact form.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. Read `design/marketing/pr/newsroom-content.json` — the content
   manifest produced by `/market:pr:newsroom`. **Required**.
   Without it, stop and ask the user to run
   `/market:pr:newsroom generate` first.
4. If `product/.pencil-seo.json` exists, read it and resolve
   `archetypeTargets = strategy.perArchetypeTargets["newsroom"]`.
   When archetype targets aren't configured for `newsroom`, fall
   back to the `marketing` archetype's targets and surface a
   recommendation to add a `newsroom` archetype to the strategy.
5. Read patterns: `patterns/hero.pen`, `patterns/cta.pen`,
   `patterns/footer.pen`. The newsroom composes these.
6. Resolve flags:
   - `--release-list-style cards|list|chronological` —
     rendering style for the recent-releases section. Default
     `cards`. Cards = visual grid with thumbnail+headline+date;
     list = compact list with date+headline+lead;
     chronological = newspaper-style column with month/year
     dividers.
   - `--with-form` — include embedded press-contact form.
     Default true.
   - `--fidelity low|hi` — per the suite's universal convention.
     Default `hi`.

## Embedded prompt

> Build a Pencil page named **`Templates / Newsroom`** for
> **{{brand}}** — the newsroom is the brand's owned PR surface.
> Render at the canonical 3 breakpoints: Mobile (390),
> Tablet (768), Desktop (1440).
>
> Read content from `design/marketing/pr/newsroom-content.json`
> (the content manifest produced by `/market:pr:newsroom`).
> Every section's content comes from the manifest; this template
> doesn't author copy.
>
> ### Section order (top to bottom)
>
> **1. Top nav (sticky)**
> Standard marketing chrome — same as templates/marketing.md and
> templates/landing-page.md. The newsroom is part of the
> marketing site; nav is consistent.
>
> **2. Hero**
> Per `manifest.hero`:
> - Display headline: `{{manifest.hero.headline}}`
> - Subhead: `{{manifest.hero.subhead}}`
> - Primary CTA: button labeled `{{manifest.hero.primaryCTA.label}}`
>   pointing to `{{manifest.hero.primaryCTA.target}}`
> - Secondary CTA: link labeled
>   `{{manifest.hero.secondaryCTA.label}}` pointing to
>   `{{manifest.hero.secondaryCTA.target}}` (mailto: typically)
> - Visual treatment: cleaner than landing-page hero — newsroom
>   isn't conversion-driven; signals authority + clarity. Use
>   single brand-accent color, generous whitespace, no
>   busy-illustration treatments.
>
> **3. Recent press releases**
> Section header: "Recent press releases" (h2)
>
> Iterate `manifest.recentReleases` (default 8 items). Per
> `--release-list-style`:
>
> **Cards style** (default):
> 3-column grid (desktop) / 2-column (tablet) / 1-column (mobile).
> Each card:
> - Thumbnail or release-type-iconography (no thumbnail =
>   accent-tinted Surface with type label "Product launch",
>   "Funding announcement", etc.)
> - Date (e.g. "May 15, 2026") in body-sm muted color
> - Headline (h3, 2-line clamp) — `{{release.headline}}`
> - Lead paragraph (body-md, 3-line clamp) —
>   `{{release.leadParagraph}}`
> - Footer with "Read full release →" link to
>   `{{release.fullReleaseUrl}}` and "Download PDF" link to
>   `{{release.downloadUrl}}`
>
> **List style**:
> Single-column compact list. Each row:
> - Date (left, fixed-width column) | Headline + lead
>   (right, flexible) | "Read more →" (right edge)
> - Horizontal rule between rows
>
> **Chronological style**:
> Newspaper-style column with month/year dividers ("May 2026",
> "April 2026"). Releases under each divider as compact entries
> (date + headline + lead).
>
> Below the list: "View all press releases →" link to
> `{{manifest.olderReleasesArchiveUrl}}`. RSS subscribe link
> ("Subscribe via RSS") to `{{manifest.rss.url}}`.
>
> **4. Media kit**
> Section header: "Media kit" (h2)
> When `manifest.mediaKit.enabled`:
> - Subhead: `{{manifest.mediaKit.summary}}`
> - Full-bleed Surface with brand-accent treatment
> - Primary CTA: "Download full media kit ({{totalSize}})"
>   button pointing to `{{downloadUrl}}`
> - Secondary CTA: "Browse files →" link pointing to
>   `{{browseUrl}}`
> - Below: small grid showing what's included (logos,
>   headshots, fact sheet, brand guidelines) as iconified
>   tiles
> - "Last updated {{lastBuilt}}" caption
>
> **5. Executive bios**
> Section header: "Speaking engagements & interviews" or
> "Our team" (h2 — pick per brand context)
>
> Iterate `manifest.executives`. Per executive:
> - Card with photo (square crop, 200×200), name (h3), title
>   (body-md), short bio (body-md, 3-line clamp), topics list
>   (small chips: "Strategy", "Fundraising", etc.)
> - "Available for interview" link below each card pointing to
>   press-contact (mailto with subject prefilled)
>
> Layout: 2-column (desktop), 1-column (tablet/mobile).
>
> **6. Press contact**
> Section header: "Press contact" (h2)
> Two-column (desktop) layout:
> - Left: contact info card with
>   `{{manifest.pressContact.name}}`,
>   `{{manifest.pressContact.title}}`, email + phone, response-
>   time expectation ("Typical response: same business day")
> - Right (when `--with-form`): embedded form with fields
>   `name`, `publication`, `email`, `subject`, `message`,
>   submit button. When form not included, fold contact info
>   into single-column treatment.
>
> Mobile: stack to single column. Form below contact info.
>
> **7. Footer**
> Standard marketing footer. Same as marketing.md and
> landing-page.md.
>
> ### Visual treatment
>
> - Newsroom signals authority + clarity, not promotion.
>   Restrained color usage — primarily neutrals with single
>   brand-accent moments at section CTAs and hero.
> - Press releases are the content; design supports without
>   competing.
> - Date stamping prominent throughout (release dates, "last
>   updated" on media kit, "as of" on press contact response-
>   time expectation).
>
> ### Naming
> - Page-level frame: `newsroom-desktop`, `newsroom-tablet`,
>   `newsroom-mobile`.
> - Section frames: `nav`, `hero`, `recent-releases`,
>   `media-kit`, `executives`, `press-contact`, `footer`.

## SEO + AIO contract

Newsroom is a high-leverage SEO surface — branded keyword
domination ("{{Brand}} newsroom", "{{Brand}} press") and AI
search citation source for "what has {{Brand}} announced?"
queries.

When `archetypeTargets` is resolved from `.pencil-seo.json`,
apply:

**Heading hierarchy** — exactly one `<h1>` (the hero headline,
e.g. "{{Brand}} Newsroom"). Section frames become `<h2>`
(`Recent press releases`, `Media kit`, `Speaking engagements`,
`Press contact`). Individual press-release headlines in the
list become `<h3>` per item.

**Primary keyword placement** — `{{Brand}} newsroom` and
related branded keywords in:
- The H1 (hero headline)
- The first 100 words (hero subhead)
- The page title
- The meta description

**Meta description** — concrete description of the newsroom's
contents. "Press releases, media resources, executive bios,
and press contact for journalists covering {{Brand}}."

**Structured data emission points** — newsroom emits:

- `Organization` — site-wide; newsroom page may include
  extended Organization data (foundingDate, founders[],
  numberOfEmployees from boilerplate)
- `NewsArticle` — for each press release referenced (in addition
  to each release's own page emission)
- `BreadcrumbList` — Home > Newsroom
- `Person` — for each executive in the executive-bios section
- `ContactPoint` — for press contact (typed as `customer service`
  with `contactType: "press"`)

**AIO patterns** — newsroom benefits from:

- `date-stamped-facts` — **required**. Every release has its
  date prominent. "Last updated" on media kit prominent.
- `definitive-headings` — section H2s as definitive
  ("Recent press releases" not "Latest news") — but watch
  for natural news-language ("Press releases" works as both)
- `factual-density` — high; newsroom is reference content
- `citation-ready` — release list is a structured chronological
  archive; AI search engines extract "{{Brand}}'s recent
  announcements" from this cleanly

**Internal linking** — high density. Each release card links
to the full release page; media kit links to media-kit pages;
executive cards link to press-contact email; archive link to
older releases. Minimum `internalLinksMin` (default 8 for
newsroom — substantially higher than other archetypes).

**Image alt text** — required. Executive headshots get
descriptive alt text ("Headshot of Jane Doe, CEO of Acme,
smiling against a neutral background"). Press-release
thumbnails get descriptive alt text per release.

**RSS feed reference** — `<link rel="alternate" type="application/
rss+xml" title="{{Brand}} Newsroom" href="/newsroom/rss.xml">` in
the page head. The build-components step emits this.

When `.pencil-seo.json` is missing, apply baseline correctness
plus prominent date-stamping. Surface SEO recommendation.

## Execution

```bash
pencil --out design/templates/newsroom.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above, with manifest content inlined}}
PROMPT
)"
```

## Verify

Screenshot all three viewport frames. Spot-check:
- Hero subhead frames the newsroom's purpose clearly
- Recent-releases section renders all manifest items
- Media-kit section enabled when manifest indicates available
- Executive bios pulls from manifest.executives correctly
- Press-contact form (when included) has all required fields
- Footer matches marketing chrome
- All headings cascade correctly (h1 → h2 → h3) without skips
- All release dates prominent and date-formatted correctly
- All images have alt text in metadata

Verify the SEO contract:
- One `<h1>` only
- Primary keyword present in expected slots
- Internal links count >= `internalLinksMin`
- Date stamping prominent throughout

Run `/market:pr:newsroom refresh` if releases changed since
this template was generated — the manifest update propagates to
the next template build.
