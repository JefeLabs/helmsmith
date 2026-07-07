---
description: Establish, bootstrap, or audit SEO + AIO strategy for the project. SEO (Search Engine Optimization) makes content rankable in search engines; AIO (AI Optimization) makes content cited by AI search engines and answer engines (Google AI Overviews, Perplexity, ChatGPT search, Claude search). Both share underlying analysis (keyword research, structured data, content audit) but optimize for different targets. Output is product/.pencil-seo.json plus an optional human-readable seo-strategy.md.
argument-hint: [--explore | --from google-eeat|backlinko|ahrefs|animalz|custom | --audit] [--seo-emphasis light|balanced|heavy] [--aio-emphasis light|balanced|heavy] [--engines <list>] [--scope <glob>] [--out <path>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Establish SEO + AIO strategy. Voice (`market/tone/explore`)
is how the brand sounds; editorial (`product/strategy/editorial`) is
mechanical-style consistency; SEO + AIO is **discoverability
discipline** — making content findable in traditional search
and citable by AI search engines.

This command is the orchestration layer. The output —
`product/.pencil-seo.json` — is read by hi-fi generation commands
(pencil/templates/*, marketing/ads/landing.md) to apply correct
SEO/AIO patterns. Audit Plane 9 detects drift over time.

## SEO vs AIO — the two disciplines

| Discipline | Target                                       | Optimizes for                              |
| ---------- | -------------------------------------------- | ------------------------------------------ |
| **SEO**    | Search engines (Google, Bing)                | Ranking + click-through to your page       |
| **AIO**    | AI search / answer engines (Perplexity, ChatGPT search, Google AI Overviews, Claude search) | Citation + reference in AI-generated answers |

Both share underlying analysis — keyword research, structured
data, content audit, technical hygiene. They diverge on what
specific content patterns get rewarded:

- **SEO rewards**: backlinks, domain authority, content depth,
  user engagement signals (CTR, dwell time), page speed,
  mobile-first design, internal linking, topic clustering
- **AIO rewards**: factual density, definitive statements,
  structured Q&A patterns, citation-friendly structure
  (numbered lists, comparison tables), explicit definitions,
  date-stamped factual claims, JSON-LD structured data quality

There's substantial overlap — both reward semantic HTML,
structured data, content clarity — but content optimized for
one target sometimes underperforms for the other. A heavy-with-
narrative blog post can rank great in Google but get bypassed
by LLMs because the facts are buried in prose. A factual
reference page with bullet-pointed answers gets cited heavily
by LLMs but might rank lower in Google for being "thin."

The discipline in 2026: optimize for both, with explicit
awareness of which target each page is leaning toward. The
`--seo-emphasis` and `--aio-emphasis` flags control the balance.

## When to use which mode

- **`--explore`** (default) — fresh setup. Generates 2-3 strategy
  candidates calibrated to industry + brand + audience.
- **`--from <reference>`** — bootstrap from a named SEO/AIO
  framework. Faster than --explore.
- **`--audit`** — scan existing artifacts for SEO/AIO drift.
  Surfaces what's already optimized vs what's missing.

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Read `product/.pencil-brand.json` for industry, audience,
   audience-regulation context.
3. Read `product/.pencil-tone.json` if it exists — voice
   modulates SEO copy (formal voice tilts toward complete
   sentences in meta descriptions; casual voice tilts toward
   active framing).
4. Read `product/.pencil-editorial.json` if it exists —
   editorial style affects metadata casing, terminology
   consistency in keyword targeting.
5. Read `design/research/<industry>.json` if it exists —
   competitive research with `--features` and `--semrush`
   provides keyword volume + competitor SEO insights.
6. Resolve mode:
   - No mode flag → `--explore`
   - Multiple mode flags → error: "Pick one mode."
7. Resolve inputs:
   - `--seo-emphasis light|balanced|heavy` — SEO investment
     level. Default `balanced`. `light` = correctness baseline
     only (semantic HTML, basic meta tags); `heavy` = aggressive
     optimization (content clusters, comprehensive structured
     data, link-building strategy).
   - `--aio-emphasis light|balanced|heavy` — AIO investment
     level. Default `balanced`. Same scale as SEO.
   - `--engines <comma-list>` — search engines targeted. Default
     `google,bing,perplexity,chatgpt-search,claude-search`.
     Engine-specific targeting affects emphasis distribution
     (e.g. heavy AIO emphasis with engines limited to AI
     search means SEO infrastructure can be lighter).
   - `--scope <glob>` (audit mode) — paths to scan. Default
     `design/templates/*.pen`, `design/pages/*.pen`,
     `src/app/**/*.{tsx,jsx}`, generated HTML in
     `dist/**/*.html`.
   - `--out <path>` — human-readable strategy reference.
     Default `design/seo-strategy.md`. Skip with `--out none`.
   - `--dry-run` — preview without writing.
8. Check existing `.pencil-seo.json`:
   - Doesn't exist → proceed
   - Exists + `--explore` → confirm overwrite
   - Exists + `--from <ref>` → confirm overwrite
   - Exists + `--audit` → no conflict; audit doesn't write

## Mode 1 — `--explore`

### Phase 1 — Calibrate

Synthesize from inputs:

- **Industry SEO baseline** — what category-typical
  optimization looks like. B2B SaaS leans content-cluster +
  thought-leadership; e-commerce leans product-schema +
  category-page-depth; documentation sites lean topical
  authority + comprehensive coverage; news/editorial leans
  freshness + entity-authority; healthcare leans E-E-A-T +
  YMYL (Your Money Your Life) signals heavily.
- **Audience search behavior** — how the target audience finds
  information. Developers Google + use Stack Overflow + ask
  LLMs directly (high AIO emphasis warranted); enterprise
  buyers Google extensively + read analyst reports (high SEO
  emphasis); consumers increasingly use AI search and social
  search (mixed emphasis).
- **Brand context** — industry, audience-regulation,
  positioning. K-12 ed-tech serving administrators implies
  topical authority + trust-signal-heavy SEO; consumer-facing
  serving end-users implies brand-first SEO with stronger
  AIO patterns for FAQ-heavy content.
- **Competitive landscape** (when research is available) —
  what competitors rank for, what keywords they own, where
  gaps exist.

Output a "Read of the SEO calibration" block. The user
confirms before candidates generate.

### Phase 2 — Generate strategy candidates

Generate 2-3 strategy candidates spanning meaningful range.
Each candidate has:

- **Name** — short label ("Authority Builder", "Conversion
  Optimizer", "AI-Native")
- **Summary** — one sentence
- **SEO emphasis level** + rationale
- **AIO emphasis level** + rationale
- **Primary keywords** — 5-15 high-priority targets with
  intent classification
- **Content cluster strategy** — pillar+cluster, hub+spoke,
  topical-authority, or ad-hoc
- **Structured data depth** — minimal, comprehensive, or
  aggressive
- **Per-archetype targets** — what each template type
  (landing-page, documentation, pricing, etc.) should
  optimize for
- **Technical SEO baseline** — Core Web Vitals targets,
  mobile-first commitment, hreflang config when applicable
- **AIO patterns** — which patterns get applied (FAQ schema,
  comparison tables, definitions, structured Q&A, factual
  density)
- **Crawler accessibility** — robots.txt + llms.txt config

Make candidates **meaningfully distinct**. Three candidates
clustered around "balanced SEO + balanced AIO + Google primary"
is a failed exploration.

A good triad spans:

```
Candidate A — "Authority Builder" (SEO-heavy, AIO-balanced)
  SEO emphasis:        heavy
  AIO emphasis:        balanced
  Primary engines:     Google, Bing
  Content cluster:     pillar+cluster (5 pillar pages, 30+ cluster pages)
  Structured data:     comprehensive (Article, FAQ, BreadcrumbList, Organization)
  Per-archetype:
    landing-page:      H1 keyword-led, 1500+ word target,
                       FAQ section, comparison table
    documentation:     topical authority, internal-linking dense
    pricing:           Product schema, Offer schema, FAQ
  Best fit:            B2B with established content team;
                       3-month+ horizon; long-term ranking play

Candidate B — "AI-Native" (SEO-balanced, AIO-heavy)
  SEO emphasis:        balanced
  AIO emphasis:        heavy
  Primary engines:     Perplexity, ChatGPT-search, Claude-search,
                       Google (AI Overviews specifically)
  Content cluster:     hub+spoke (1 hub page, 10-15 spoke pages,
                       each with strong factual density)
  Structured data:     aggressive (everything Schema.org offers
                       that fits, JSON-LD priority)
  Per-archetype:
    landing-page:      definitive-headings, FAQ schema required,
                       comparison table required, factual density
                       optimized
    documentation:     structured Q&A primary format,
                       date-stamped facts, citation-ready
    pricing:           explicit feature comparison, structured
                       definitions per feature
  Best fit:            Newer brands competing against established
                       SEO incumbents; tech-forward audience;
                       AI search is primary discovery mechanism

Candidate C — "Conversion Optimizer" (SEO-light, AIO-light)
  SEO emphasis:        light (correctness baseline only)
  AIO emphasis:        light
  Primary engines:     Google primary; AI search opportunistic
  Content cluster:     ad-hoc (no formal cluster strategy)
  Structured data:     minimal (semantic HTML + basic Organization)
  Per-archetype:
    landing-page:      conversion-focused, brand-led copy,
                       SEO secondary
    pricing:           price-clarity primary, basic Product schema
  Best fit:            Paid-traffic-dominant brands; SEO is
                       complement to ads, not primary; smaller
                       team without content investment
```

The dimensional spread reveals what each strategy *does* in
practice. Abstract strategy descriptions ("we want to do SEO")
are hard to react to; concrete per-archetype + content-cluster
+ structured-data choices are.

### Phase 3 — User picks (or hybrids)

- **Pick one** — straightforward
- **Hybrid** — "B's AIO patterns with A's content cluster
  strategy". Synthesize the hybrid; show resulting per-archetype
  targets for confirmation.
- **None of these** — request another round with adjusted
  feedback ("more aggressive on AIO; we're seeing AI search
  drive 30% of new traffic").

### Phase 4 — Persist

Write `product/.pencil-seo.json` per the schema in
`.product-seo-schema.json`. Critical fields:

- `version: 1`
- `establishedAt: <ISO>`, `lastRefreshedAt: <ISO>`
- `name`, `summary`
- `inheritedFrom: null` (no named guide for explore mode)
- All schema sections fully populated

Also generate the human-readable `design/seo-strategy.md`
(when `--out` is not `none`) — a one-page reference card
formatted for non-technical readers. Includes per-archetype
targets in plain language.

When `--dry-run`, print the JSON and stop.

## Mode 2 — `--from <reference>`

### Phase 1 — Load named framework defaults

Recognized references (case-insensitive):

- **`google-eeat`** — Google's Experience-Expertise-Authoritativeness-Trustworthiness framework. Modern Google quality guidelines.
- **`backlinko`** — Brian Dean / Backlinko methodology. Strong on link-building, on-page SEO, content depth.
- **`ahrefs`** — Ahrefs methodology with content cluster strategy. Strong on keyword research + competitive analysis + topical authority.
- **`animalz`** — Animalz methodology, SaaS content marketing leaning. Strong on long-form thought leadership + content distribution.
- **`custom`** — placeholder; the command asks for `--reference <url-or-path>` and bootstraps from a minimal base.

Each named reference has a baked-in default profile:

**`google-eeat` highlights**:
- Heavy emphasis on E-E-A-T signals (author bylines, expertise badges, citation density)
- YMYL category awareness (financial, health, legal content needs higher trust signals)
- Comprehensive structured data (Author schema, Organization schema, Article schema)
- Update-frequency tracking (date-published, date-modified prominent)
- AIO emphasis: balanced (Google AI Overviews favors E-E-A-T-strong content)

**`backlinko` highlights**:
- Skyscraper content pattern (longer + more comprehensive than competing pages)
- Heavy on-page optimization (keyword in H1/title/URL/first 100 words)
- Internal linking dense (3-5 relevant internal links per page)
- Content depth target: 1500+ words for pillar pages
- AIO emphasis: balanced (long-form gets cited but not as much as AIO-native patterns)

**`ahrefs` highlights**:
- Pillar-and-cluster content topology mandatory
- Keyword difficulty scoring drives prioritization (KD < 30 for new sites)
- Topical authority signaled by depth-of-coverage
- Internal linking follows cluster topology strictly
- AIO emphasis: light-to-balanced (Ahrefs methodology predates AI search; SEO-primary)

**`animalz` highlights**:
- Long-form thought leadership primary
- "Customer story SEO" — case studies + testimonials as content
- Distribution-thinking integrated with creation
- SaaS-leaning verticals
- AIO emphasis: balanced (long-form thought leadership cites well in AI search)

### Phase 2 — Surface deviations

After loading defaults, ask if the team has known deviations:

```
You're bootstrapping from Ahrefs methodology. Default config:

  - Pillar+cluster topology required
  - SEO emphasis: heavy
  - AIO emphasis: light-to-balanced
  - Content depth: 1500+ words for pillars, 800+ for clusters
  - Structured data: comprehensive
  - Internal linking: cluster-strict (pillars link to clusters,
    clusters link to pillar + 2-3 sibling clusters)

Any deviations?
  Common deviations:
    - "We want to lean harder on AIO" → aioEmphasis = "heavy"
    - "We don't have bandwidth for 30+ cluster pages" →
       contentClusterStrategy = "hub-spoke" (1 hub, 10 spokes)
    - "We're a new site with low domain authority" →
       focus on long-tail keywords first

Press enter to accept defaults, or describe deviations.
```

User describes free-form or skips. Each deviation gets parsed
and recorded in `deviations` array with rationale.

### Phase 3 — Persist

Write with `inheritedFrom: "<reference>"` and any deviations.

## Mode 3 — `--audit`

### Phase 1 — Scan in-scope artifacts

Walk `--scope`. For each file, extract SEO-relevant signals:

**`.pen` files** — design source. Extract:
- Heading hierarchy (H1 frame, H2 frames, H3+ frames)
- Meta description slot (when archetype defines one)
- Title slot
- Image elements (for alt text)
- Structured data slots (when archetype defines them)
- Internal link targets (when explicit)

**`.tsx`/`.jsx`** — React source. Extract:
- `<title>` and `<meta>` tags
- Heading hierarchy in JSX
- `<img alt>` attributes
- JSON-LD structured data via `<script type="application/ld+json">`
- Internal link patterns

**`.html`** — compiled output. Extract:
- All meta tags
- All structured data (JSON-LD, microdata)
- Heading hierarchy
- Internal vs external link counts
- Image alt text completeness
- Core Web Vitals from build artifacts (when available)

**`.md`** — documentation/research files. Extract:
- Heading hierarchy
- Internal link patterns
- Frontmatter SEO fields when present

### Phase 2 — Surface findings

Output a sectioned report by SEO/AIO dimension:

```
SEO Audit — what's in use

ON-PAGE SEO

  Title tags:           87% present, 13% missing
                        ⚠ 14 pages missing <title>
  Meta descriptions:    78% present, 22% missing
                        ⚠ 23 pages missing meta description
  H1 hierarchy:         92% have exactly one H1 (good)
                        ⚠ 8 pages have 0 or 2+ H1s
  H2/H3 cascade:        67% follow cascade properly
                        ⚠ 33% jump levels (H1 → H3 without H2)
  Image alt text:       54% present
                        ⚠ Below accessibility baseline (should be 100%)
  Internal linking:     average 2.3 internal links per page
                        ✓ Above pillar+cluster threshold of 2

STRUCTURED DATA

  Pages with JSON-LD:   34% (38/112 pages)
  Schema types found:
    - Organization:     present site-wide ✓
    - Article:          18 pages
    - FAQ:              4 pages
    - Product:          0 pages (pricing pages should have)
    - BreadcrumbList:   0 pages (should be on all internal pages)
  ⚠ Comprehensive structured-data deployment incomplete

AIO PATTERNS

  Pages with FAQ schema: 4 (low; AIO benefits significantly)
  Definitive headings:  detected on 23 pages (good)
  Comparison tables:    detected on 12 pages (pricing,
                        feature-comparison; underused on
                        landing pages)
  Definitions explicit: detected on 18 pages (technical
                        documentation; rare on marketing pages)
  Citation-friendly structure: 41% of pages
  Date-stamped facts:   inconsistent

TECHNICAL SEO

  Core Web Vitals:      (requires build artifacts; not scanned)
  Mobile-first:         CSS media queries present site-wide ✓
  Robots.txt:           found at /robots.txt
                        ⚠ User-agent: GPTBot is blocked —
                          intentional? (this excludes the brand
                          from ChatGPT's training and citation
                          corpus)
  llms.txt:             not found
                        ⚠ AIO best practice; create at /llms.txt
                          documenting allowed AI crawlers
  Sitemap.xml:          found, 247 URLs
                        ✓ above sitemap minimum
  Canonical URLs:       43% of pages have explicit canonical
                        ⚠ Recommended: explicit canonicals
                          everywhere

CRAWLER ACCESSIBILITY

  Allowed bots:         Googlebot, Bingbot, DuckDuckBot
  Blocked bots:         GPTBot (likely unintentional?)
  Missing in robots:    ClaudeBot, PerplexityBot (not blocked
                        but not explicitly allowed either)
```

### Phase 3 — Optionally accept the de facto state

After surfacing findings, offer:

```
Convert audit findings into canonical .pencil-seo.json?

  Dominant patterns become canonical fields. Ambiguous areas
  get flagged with `resolutionNeeded: true` for future audits.

  [Y]es — write .pencil-seo.json based on audit
  [n]o, just keep the report
  [r]efine first (manual edit)
```

When accepted, `inheritedFrom: "audit"` is recorded.

## Voice / editorial / SEO alignment check

After any successful establishment, run alignment check:

- High formality voice + AIO-heavy strategy → potential
  misalignment. AIO patterns favor short, definitive
  statements; high formality voice favors complete subordinate
  clauses. Surface for confirmation.
- Heavy AIO + sentence-case-everywhere editorial → reasonable
  alignment (both prefer scannable structure).
- Heavy AIO + low factual density target → contradiction.
  Surface as warning.
- High audience-regulation (k-12, healthcare, financial) +
  light SEO → flag. Regulated industries usually need stronger
  trust signals (E-E-A-T) which means heavier SEO investment.

Misalignment isn't fail; it's surface for the user to confirm
or correct.

## Reporting

Illustrative — adapt to mode and outcome:

```
✓ SEO + AIO strategy established: "AI-Native" (Backlinko-bootstrapped, AIO-heavy hybrid)

Source:           product/.pencil-seo.json
Reference card:   design/seo-strategy.md

SEO emphasis:     balanced
AIO emphasis:     heavy

Primary engines:
  Google (with AI Overviews focus), Perplexity,
  ChatGPT-search, Claude-search

Content cluster: hub+spoke
  Hub: /docs/saved-searches (pillar)
  Spokes: 12 cluster pages (use cases, integrations,
          comparison, etc.)

Structured data:  aggressive
  Per archetype:
    landing-page:    Article + FAQ + Organization + Product
    documentation:   Article + HowTo + Q&A + BreadcrumbList
    pricing:         Product + Offer + FAQ + Organization
    legal:           Article + Organization

AIO patterns:
  - FAQ schema:           required per page
  - Comparison tables:    required where applicable
  - Definitive headings:  preferred
  - Date-stamped facts:   required
  - Structured Q&A:       preferred for documentation
  - Citation-friendly:    required

Technical baseline:
  Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1
  Mobile-first:    yes
  llms.txt:        /llms.txt (allowing GPTBot, ClaudeBot, PerplexityBot)
  robots.txt:      ai-bots allowed, sitemap referenced

Voice/editorial alignment: ✓ aligned
  Voice (Confident Mentor) + AIO-heavy compatible — voice's
  complexity 3 supports AIO's preference for clear, scannable
  structure.

Channels can now apply this strategy:
  - pencil/templates/* read for per-archetype targets
  - heroui/build-components.md emits SEO-correct HTML
  - marketing/ads/landing.md uses for landing message-match
  - audit Plane 9 detects drift over time
```

## Idempotency

Re-running with same mode + arguments overwrites
`.pencil-seo.json`. Backups kept as
`.pencil-seo.<timestamp>.json`.

For minor adjustments (adding a keyword, updating a target),
hand-edit the JSON. For major shifts (changing emphasis level,
swapping content cluster strategy), re-run with new arguments.

## What this command does NOT do

- **Does not perform keyword research from scratch.** Keyword
  research uses Semrush + Ahrefs + Google Keyword Planner data
  (which the command can reference via `--informed-by` to a
  research file with `--semrush` data, but doesn't re-perform
  the API calls). Pull keyword data via
  `/product:strategy:research --semrush` first.
- **Does not generate content.** Content writing happens via
  pencil/templates/* and editorial review. This command
  produces the strategy that informs content.
- **Does not test technical SEO in real-time.** Core Web
  Vitals require build + measurement; the command captures
  targets but doesn't verify pages meet them. Use Lighthouse
  / WebPageTest / PageSpeed Insights for measurement.
- **Does not handle backlink strategy.** Off-page SEO (link
  building, PR, partnerships) is human-driven outreach work.
- **Does not auto-fix audit findings.** Plane 9 surfaces drift;
  fixes happen via per-template re-generation.
- **Does not handle sitemap.xml or robots.txt generation.**
  Those are infrastructure files; the strategy informs what
  they should contain, but writing them is engineering work.
  The metadata captures intent; deployment honors it.
