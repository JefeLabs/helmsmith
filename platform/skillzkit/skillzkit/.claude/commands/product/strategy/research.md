---
description: Capture industry, competitor, and trend data to inform downstream selection commands. Surveys competitor sites, extracts their token systems, identifies page-type frequency, and surfaces differentiation opportunities. Output is the upstream input that pattern-select and template-select read to recommend what a project actually needs.
argument-hint: <industry-name> [--competitors <url1,url2,...>] [--brief <slug>] [--depth quick|standard|deep] [--out <path>] [--semrush] [--semrush-api-key <key>] [--features] [--features-mode auto|curated]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Survey an industry's design landscape — competitor sites, common
patterns, prevailing trends, differentiation opportunities — and
output structured research that downstream commands consume to
recommend what a project actually needs. This is the missing
"upstream of selection" command that turns Pencil from a catalog of
universal templates into a research-driven design system.

Without this command, every selection command falls back to
universal defaults. With it, `/product:design:patterns:select` knows that
B2B ed-tech sites consistently use hero-split-with-screenshot but
rarely use video-hero (so video-hero becomes a differentiation
opportunity), and `/product:design:templates:select` knows that documentation
templates are essential for dev-tools (90% of competitors have one)
but optional for ed-tech (10%).

## Where this fits

```
brief                                    (intent)
  ↓
research <industry>                      ◀── THIS — captures landscape
  ↓
foundations:colors-select  --informed-by  ┐
foundations:fonts-select   --informed-by  ├── selection commands consume research
foundations:imagery-select --informed-by  │
patterns:select            --informed-by  │
templates:select           --informed-by  ┘
  ↓
pattern / template generation
  ↓
design-page → finalize → build-components
```

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Resolve inputs:
   - First positional arg: industry name (e.g. "B2B ed-tech",
     "developer tooling", "sports platform", "fintech consumer").
     If a `--brief` is provided, default to the brief's `industry`
     field.
   - `--competitors` — comma-separated URLs. If absent, the command
     suggests competitors based on the industry name and asks the
     user to confirm before proceeding (don't survey strangers
     silently).
   - `--depth` — `quick` (homepage + pricing + signup per
     competitor, ~3 pages), `standard` (default — adds a content/
     dashboard sample, ~5 pages), `deep` (adds documentation and
     marketing content, ~8 pages).
3. Verify Playwright (or equivalent headless browser) is available.
   If not, fall back to user-provided screenshots passed via
   `--screenshots <dir>`.
4. Resolve output paths:
   - Narrative: `design/research/<industry-slug>.md`
   - Visual comparison: `design/research/<industry-slug>.pen`
   - Structured data: `design/research/<industry-slug>.json`
5. Resolve optional augmentations:
   - **`--semrush`** — pull market signal data from Semrush
     (competitor discovery via keyword overlap, traffic estimates
     for page prioritization, domain authority for weighting).
     Requires `--semrush-api-key <key>` or `SEMRUSH_API_KEY` env.
     Verify the key works with a no-op API call before proceeding.
     If the key fails or the API is unreachable (constrained
     network), surface clearly and offer to proceed without
     augmentation.
   - **`--features`** — extract a feature matrix per competitor
     (what each competitor's product *does*, alongside what it
     *looks like*). Default mode `auto` (LLM-driven enumeration
     from captured pages); alternative `curated` pauses for user
     input.
   - Both augmentations are optional and additive. Without them,
     research runs as it always has — competitor URL list,
     pattern frequency analysis, narrative + visual + JSON output.

## Phase 1 — Industry conventions analysis

Before surveying specific competitors, establish baseline conventions
for the industry. This is qualitative analysis the AI does from its
training:

| Dimension              | Capture                                              |
| ---------------------- | ---------------------------------------------------- |
| **Color conventions**  | Dominant palettes (e.g. fintech leans blue + green; education leans warm; healthcare leans muted teal/coral) |
| **Typography conventions** | Common pairings (e.g. dev-tools lean Inter/JetBrains Mono; editorial leans serif display + sans body) |
| **Imagery conventions** | What kind of imagery is standard (e.g. consumer SaaS uses people-illustration; B2B enterprise uses abstract gradients; education uses lifestyle photo) |
| **Tone conventions**   | Voice baselines (e.g. dev-tools direct/technical; consumer friendly; enterprise authoritative) |
| **Page structure conventions** | Which page types are universal (every site has marketing, signup, signin) vs industry-specific (dev-tools have docs; SaaS have pricing; ed-tech have demo-request flows) |
| **Trust signals**      | Standard trust patterns (e.g. SOC 2 badges for B2B SaaS; FERPA + state-of-the-art encryption for ed-tech; FDIC for fintech) |
| **Regulatory cues**    | Visible regulatory affordances (e.g. cookie banner for EU-serving; "Do Not Sell" link for CA; accessibility statement for govt) |

Output: a "Read of the industry" block that prints before specific
competitor capture begins. The user confirms or corrects the
calibration — the AI's industry priors might be stale.

## Phase 1.5 — Semrush competitor discovery (when `--semrush`)

When `--semrush` is set, this phase queries Semrush's API to
discover competitors and rank them by market signal. Skip
entirely without `--semrush` — Phase 2 still works with the
user-provided `--competitors` list or asks for one interactively.

The phase has three sub-steps:

### 1.5a — Discover competing domains via keyword overlap

If `--competitors` was provided by the user, this step is
**augmentation, not replacement**: Semrush surfaces additional
candidates the user may not have known about. The user reviews
and decides which to add.

If `--competitors` was not provided, this step is **discovery**:
the industry name is used as a seed query to find domains
ranking for relevant keywords.

```
Semrush query: domain_organic_organic / keyword search
Industry seed: "B2B ed-tech" (interpreted as keyword cluster)
Discovered competitors (top 10 by organic keyword overlap):
  1. competitor-a.com — DA 67, 1,247 shared keywords
  2. competitor-b.com — DA 54, 891 shared keywords
  3. competitor-c.com — DA 49, 634 shared keywords
  ...

User picks which to include. Already-supplied --competitors are
pre-checked.
```

The user's selection becomes the canonical competitor list for
Phase 2.

### 1.5b — Capture market signal per competitor

For each competitor in the final list, fetch:

- **Domain authority** (Semrush's score, 1-100)
- **Estimated organic traffic** (monthly)
- **Keyword overlap** with this industry's keyword set
- **Top 5 pages by traffic** (URL + estimated monthly traffic)
  — these become the priority pages to capture in Phase 2,
  potentially overriding `--depth`'s default page list

The market signal data is recorded in research.json's new
`marketSignal` field (schema below) for downstream commands.

### 1.5c — Authority-weighted frequency analysis

Phase 3's pattern/template frequency analysis (which currently
treats each competitor equally) is upgraded when market signal
data is available. Each competitor's contribution to frequency
calculations is weighted by their domain authority:

```
weighted_frequency(pattern) =
  sum(competitor_da * has_pattern) / sum(competitor_da)
```

A pattern present on 2 high-DA competitors (DA 80 + 75) carries
more signal than a pattern present on 5 low-DA competitors
(DA 20 each). The unweighted frequency stays available in the
JSON output (`patternFrequency` unchanged); the weighted version
is added as `patternFrequencyWeighted`.

### What Semrush adds without `--semrush`

Nothing — research runs identically to its un-Semrush behavior.
This is a strict augmentation; absence of Semrush doesn't degrade
the base research.

### Constrained-mode note

In environments where api.semrush.com isn't reachable, `--semrush`
fails its pre-flight credential check and the command proceeds
without augmentation, with a clear note in the report. CI flows
should not require `--semrush` to pass.

## Phase 2 — Competitor capture

For each competitor URL:

1. **Identify pages to capture** (per `--depth`):
   - `quick`: `/`, `/pricing`, `/signup` (or equivalent paths
     auto-detected)
   - `standard`: + `/dashboard` or `/demo`, + a content page
     (`/blog`, `/customers`, `/case-studies`)
   - `deep`: + `/docs` (or equivalent), + `/about`, + `/careers`,
     + `/changelog`

   **When `--semrush` is set**: replace the depth-driven default
   with the competitor's top 5 pages by estimated traffic from
   Phase 1.5b. The reasoning: a competitor's high-traffic pages
   are the ones actually pulling users in — better signal for
   pattern analysis than mechanically capturing /pricing or
   /signup which may not be load-bearing for that specific
   competitor. The captured page set is recorded in research.json
   under `pages[].sourceReason: "semrush-top-traffic"`.
2. **Capture each page**:
   - Screenshot at 1440×900 desktop viewport
   - Run `/product:strategy:tokens-from <url>` to extract tokens
   - Walk DOM to identify pattern instances (heroes, feature-grids,
     testimonials, pricing tiers, etc.) — heuristic via section
     headings, role attributes, ARIA landmarks
3. **Aggregate per competitor**:
   - Tokens (palette, typography stack, spacing rhythm)
   - Page types present (`marketing-landing`, `pricing`, `signin`,
     `signup`, `docs`, etc.)
   - Patterns instantiated (`hero-centered`, `feature-grid-3x2`,
     `testimonial-grid`, `pricing-3-tier`, `faq-accordion`, etc.)
   - Tone signals (extracted from copy: imperative vs descriptive,
     formal vs conversational, technical vs accessible)
   - Imagery direction (photographic / illustrated / abstract /
     mixed)

Per-competitor output stored in the structured JSON.

## Phase 3 — Cross-competitor frequency analysis

Aggregate across all surveyed competitors:

### Pattern frequency

How often each pattern appears across the competitor set:

```jsonc
{
  "patternFrequency": {
    "hero-centered":         0.40,  // 40% of competitors
    "hero-split-image-right": 0.80, // 80% — dominant convention
    "hero-video-bg":          0.10, // 10% — underused
    "feature-grid-3x2":       0.70,
    "feature-grid-bento":     0.20, // emerging
    "testimonial-grid":       0.65,
    "pricing-3-tier":         0.80,
    "pricing-comparison-matrix": 0.30,
    "faq-accordion":          0.85,
    "footer-marketing":       0.95
  }
}
```

Frequency tiers:

- **>= 0.75**: Universal — these are the conventions. Skipping any
  produces a site that "feels off" for the category. Pattern-select
  recommends these as essentials.
- **0.40 – 0.75**: Common — present in many but not all. Inclusion
  is a brand-fit decision.
- **0.15 – 0.40**: Niche — present in some. Inclusion needs
  justification (or signals differentiation).
- **< 0.15**: Underused — rare in the category. Either a deliberate
  trend signal (emerging) or a dead pattern (declining). Mark with
  trend-direction tag.

### Template frequency

Same shape, for template types:

```jsonc
{
  "templateFrequency": {
    "marketing-landing":       1.00, // universal
    "auth-signin":             1.00,
    "auth-signup":             1.00,
    "pricing":                 0.85,
    "dashboard-app-shell":     0.40, // depends on whether competitor has app
    "documentation-tree-content": 0.20, // 20% in this industry — niche
    "settings":                0.40,
    "onboarding":              0.30,
    "profile":                 0.15,
    "blog-marketing":          0.55,
    "legal":                   0.95   // every competitor has /privacy, /terms
  }
}
```

### Trend signals

Patterns flagged as trending up or down across the surveyed set
(based on adoption recency vs. older sites in the same category):

```jsonc
{
  "trends": [
    { "pattern": "feature-grid-bento", "direction": "rising", "confidence": 0.7 },
    { "pattern": "ai-feature-callout", "direction": "rising", "confidence": 0.9 },
    { "pattern": "hero-illustration",  "direction": "stable", "confidence": 0.6 },
    { "pattern": "skeumorphic-buttons", "direction": "declining", "confidence": 0.9 }
  ]
}
```

Trend-direction is a heuristic — it's hard to detect with high
confidence from screenshots alone. Surface confidence scores so
downstream commands weight accordingly.

## Phase 3.5 — Feature comparison (when `--features`)

Pattern frequency answers "what do competitors *look* like." This
phase answers "what do competitors *do*." Both inform design,
but in different ways — patterns shape visual treatment;
features shape what templates need to surface.

Skip entirely without `--features`. The base research output
remains complete and useful without this phase.

### 3.5a — Extract features per competitor

Two modes:

**`--features-mode auto`** (default): the LLM enumerates each
competitor's user-facing features by reading captured pages,
marketing copy, and any pricing/feature-comparison pages. The
extraction is heuristic — features named on marketing pages,
mentioned in feature lists, or implied by visible UI. Output is
a list of feature labels per competitor.

```
Competitor A — extracted features:
  - saved-searches    (visible in dashboard demo)
  - in-app-messaging  (mentioned on pricing page)
  - guardian-portal   (dedicated marketing page)
  - export-to-csv     (feature comparison table)
  - sso              (security/enterprise page)
  - api-access       (developer page)
  - analytics        (dashboard demo)
  ...
```

The agent should label features at a consistent abstraction —
"saved-searches" not "save and reload your filtered queries."
Specific implementation details belong in `featureMatrix[*].
implementations[<competitor>]`, not the feature label.

**`--features-mode curated`**: pause and ask the user to fill a
feature matrix. The command prints a table skeleton with the
competitors as columns and asks the user to add rows for the
features they care about. Slower but produces higher-fidelity
output — appropriate for product strategy work where the feature
list itself is the deliverable.

### 3.5b — Build the feature matrix

Aggregate per-competitor feature lists into a cross-competitor
matrix:

```
                           comp-A  comp-B  comp-C  comp-D
saved-searches                 ✓      ✓             ✓
in-app-messaging              ✓                     ✓
guardian-portal               ✓             ✓
export-to-csv                 ✓      ✓      ✓      ✓
sso                           ✓             ✓      ✓
api-access                    ✓                    ✓
analytics                     ✓      ✓      ✓      ✓
ai-summarization                                   ✓
```

Each matrix entry records the competitor's implementation detail
(short string) so downstream commands can compare approaches:

```jsonc
{
  "saved-searches": {
    "presentIn": ["competitor-a", "competitor-b", "competitor-d"],
    "absentFrom": ["competitor-c"],
    "frequency": 0.75,
    "implementations": {
      "competitor-a": "filter-based with named saves and email alerts",
      "competitor-b": "tag-based, manual save trigger only",
      "competitor-d": "AI-suggested saves plus manual"
    },
    "ourPosition": "unknown"
  }
}
```

`ourPosition` defaults to `"unknown"` — the user fills it in
later (or `migrate-to-pencil` populates it during bootstrap when
the project's existing features can be enumerated). Possible
values: `"present"`, `"absent"`, `"planned"`, `"unknown"`,
`"intentionally-omitted"`.

### 3.5c — Frequency-weighted feature analysis

For each feature, compute:

- **Frequency**: ratio of competitors that have it
- **Intensity**: how prominently each competitor surfaces it
  (heuristic: dedicated marketing page = high; pricing page
  bullet = medium; only mentioned in feature comparison = low)

High frequency + high intensity = table-stakes for the category.
Low frequency + high intensity (in the few that have it) =
differentiation candidate. The output flags both ends.

### 3.5d — Surface gaps

Compare the feature matrix to your project's `ourPosition`
(once populated). Surface:

- **Table-stakes gaps**: features in 75%+ of competitors but
  marked `"absent"` or `"unknown"` for your project. These are
  catch-up requirements.
- **Differentiation candidates**: features in <30% of competitors
  but high-intensity in the ones that have them. These are
  potential standout opportunities.

Audit Plane 7 picks up the gap data later for ongoing tracking.
The research output records the snapshot.

## Phase 4 — Differentiation opportunity analysis

Surface patterns that are **underused** in the category (frequency
< 0.30) but might suit the brand. Include reasoning:

```
Differentiation opportunities:

  hero-video-bg (0.10 freq)
    Most competitors use static heroes. Video could differentiate IF:
    - Brand has commissioned or willing-to-commission video content
    - Product is itself visual (creative tools, design products)
    - Performance budget allows
    Risk: video heroes increase load time and accessibility burden.

  feature-grid-bento (0.20 freq, rising trend)
    Modern asymmetric layout pattern. Differentiation by visual
    sophistication, signals "we keep up with current design".
    Risk: trend may be over-adopted within 18 months.

  testimonial-video (0.05 freq)
    Only 1 of 20 competitors uses video testimonials. Higher trust
    signal than text-only. Differentiation by depth, but production
    cost is real.

Avoid (over-saturated patterns):
  testimonial-quote-grid (0.85 freq) — generic; doesn't add brand
  pricing-3-tier-with-most-popular (0.95 freq) — required, but
    don't expect it to differentiate
```

## Phase 5 — Render the visual research artifact

Build `design/research/<industry-slug>.pen`:

> Build a Pencil page named **`Research / {{industry}}`**.
>
> ### Section 1 — Industry summary card
> Direction summary fields populated from Phase 1 + Phase 3.
>
> ### Section 2 — Competitor comparison grid
>
> Rows = competitors (1 per surveyed brand). Columns = page types
> captured (Homepage, Pricing, Signin, etc.). Each cell is a 240×180
> screenshot thumbnail with the competitor name + page type label.
>
> Below each row: a small token strip showing the competitor's
> palette + primary fonts + imagery direction.
>
> ### Section 3 — Pattern frequency heatmap
>
> A grid showing pattern frequency with color intensity:
> - X-axis: pattern name
> - Y-axis: pattern category (hero / feature / testimonial / pricing
>   / faq / footer / etc.)
> - Cell color: frequency 0–1, ramping from `--color-neutral-100`
>   (rare) to `--color-accent-700` (universal)
>
> Each cell labeled with the percentage. Universal patterns
> (>0.75) get a `--color-accent` ring.
>
> ### Section 4 — Differentiation matrix
>
> Two-column layout:
> - Left: "Conventions" — patterns with frequency > 0.75. Brand
>   should match these unless deliberately diverging.
> - Right: "Opportunities" — patterns with frequency < 0.30 with
>   trend direction. Inclusion adds differentiation.
>
> ### Section 5 — Trend signals
>
> A timeline-style strip showing rising / stable / declining
> patterns with confidence indicators.

## Phase 6 — Persist structured output

Write three artifacts atomically:

### Narrative (`design/research/<industry-slug>.md`)

```markdown
---
slug: <industry-slug>
industry: <industry>
competitorsSurveyed: <n>
researchedAt: <ISO date>
---

# <Industry> Design Research

## Industry conventions
- Color conventions: <observed dominant palettes>
- Typography conventions: <observed pairings>
- Imagery conventions: <observed direction>
- Tone conventions: <observed voice>

## Competitors surveyed
| Brand | URL | Pages captured |
| ----- | --- | -------------- |
| ...   | ... | ...            |

## Pattern frequency
| Pattern | Frequency | Tier |
| ------- | --------- | ---- |
| ...     | ...       | ...  |

## Template frequency
| Template | Frequency | Tier |
| -------- | --------- | ---- |
| ...      | ...       | ...  |

## Differentiation opportunities
- ...

## Trend signals
- ...

## Recommended next steps
- /product:design:patterns:select   --informed-by design/research/<slug>.json
- /product:design:templates:select  --informed-by design/research/<slug>.json
- /product:design:foundations:colors-select  --informed-by design/research/<slug>.json
- /product:design:foundations:fonts-select   --informed-by design/research/<slug>.json
- /product:design:foundations:imagery-select --informed-by design/research/<slug>.json
```

### Visual (`design/research/<industry-slug>.pen`)

Per Phase 5.

### Structured (`design/research/<industry-slug>.json`)

The full data graph that downstream commands consume:

```jsonc
{
  "researchedAt": "2026-05-02T18:42:00Z",
  "industry": "B2B ed-tech",
  "industrySlug": "b2b-ed-tech",
  "competitorsSurveyed": [
    {
      "name": "Competitor A",
      "url": "https://...",
      "tokens": { "primary": "...", "fonts": {...}, "imagery": "..." },
      "pages": [
        { "type": "marketing-landing", "url": "/", "patterns": ["hero-split-image-right", "feature-grid-3x2", "testimonial-grid", "footer-marketing"] },
        { "type": "pricing", "url": "/pricing", "patterns": ["pricing-3-tier", "faq-accordion", "cta-section"] }
      ],
      "tone": { "formality": "corporate", "voice": "authoritative" },
      "imageryDirection": "lifestyle-photography"
    }
  ],
  "industryConventions": {
    "colorPalettes":   ["cool-blue-trustworthy", "warm-friendly-education"],
    "typographyPairings": ["geometric-sans-throughout", "serif-display-sans-body"],
    "imageryDirections":  ["lifestyle-photography", "illustrated-abstract"],
    "tones":              ["accessible-authoritative"]
  },
  "patternFrequency": {
    "hero-centered": 0.40,
    "hero-split-image-right": 0.80,
    "hero-video-bg": 0.10,
    "feature-grid-3x2": 0.70,
    "feature-grid-bento": 0.20,
    "testimonial-grid": 0.65,
    "pricing-3-tier": 0.80,
    "faq-accordion": 0.85,
    "footer-marketing": 0.95
  },
  "templateFrequency": {
    "marketing-landing": 1.00,
    "auth-signin": 1.00,
    "auth-signup": 1.00,
    "pricing": 0.85,
    "dashboard-app-shell": 0.40,
    "documentation-tree-content": 0.10,
    "settings": 0.40,
    "onboarding": 0.30,
    "profile": 0.15,
    "blog-marketing": 0.55,
    "legal": 0.95
  },
  "trends": [
    { "pattern": "feature-grid-bento", "direction": "rising", "confidence": 0.7 },
    { "pattern": "ai-feature-callout", "direction": "rising", "confidence": 0.9 }
  ],
  "differentiationOpportunities": [
    { "pattern": "hero-video-bg", "frequency": 0.10, "rationale": "...", "risk": "..." }
  ],

  // Optional — present only when `--semrush` was passed
  "marketSignal": {
    "source": "semrush",
    "queriedAt": "2026-05-02T18:42:00Z",
    "industrySeed": "B2B ed-tech",
    "discoveredCompetitors": [
      { "domain": "competitor-e.com", "domainAuthority": 71, "sharedKeywords": 2014, "selectedByUser": false }
    ],
    "perCompetitor": {
      "competitor-a": {
        "domainAuthority": 67,
        "estimatedMonthlyTraffic": 184000,
        "sharedKeywords": 1247,
        "topPagesByTraffic": [
          { "url": "/", "estimatedMonthlyTraffic": 78000 },
          { "url": "/features/saved-searches", "estimatedMonthlyTraffic": 23000 }
        ]
      }
    }
  },

  // Optional — present only when `--semrush` augments the analysis
  "patternFrequencyWeighted": {
    "hero-centered": 0.43,
    "hero-split-image-right": 0.84,
    "feature-grid-3x2": 0.71
  },

  // Optional — present only when `--features` was passed
  "featureMatrix": {
    "saved-searches": {
      "presentIn": ["competitor-a", "competitor-b", "competitor-d"],
      "absentFrom": ["competitor-c"],
      "frequency": 0.75,
      "intensity": { "competitor-a": "high", "competitor-b": "medium", "competitor-d": "high" },
      "implementations": {
        "competitor-a": "filter-based with named saves and email alerts",
        "competitor-b": "tag-based, manual save trigger only",
        "competitor-d": "AI-suggested saves plus manual"
      },
      "ourPosition": "unknown",
      "classification": "table-stakes"
    },
    "ai-summarization": {
      "presentIn": ["competitor-d"],
      "absentFrom": ["competitor-a", "competitor-b", "competitor-c"],
      "frequency": 0.25,
      "intensity": { "competitor-d": "high" },
      "implementations": { "competitor-d": "summarizes student progress reports for guardian view" },
      "ourPosition": "planned",
      "classification": "differentiation-candidate"
    }
  }
}
```

### Schema validation

Before writing the JSON, validate against
`product/design/.product-research-schema.json` (JSON Schema draft-07). The
schema enforces:

- Required top-level fields present
- `competitorsSurveyed` has at least 1 entry
- All hex color values match `^#[0-9a-fA-F]{6}$`
- All slugs match `^[a-z][a-z0-9-]*$` (lowercase kebab-case)
- All frequency values in `[0, 1]` range
- Page `type` values come from the canonical enum
- Trend `direction` values are `rising | stable | declining`

If validation fails, the command does NOT write the malformed JSON.
Instead, it surfaces validation errors and stops. Downstream commands
(`patterns:select`, `templates:select`) read the schema-validated JSON
with confidence — bad data fails at write-time, not at read-time
deep in another command's pipeline.

```bash
# Validation invocation (during write):
pencil-validate --schema pencil/.product-research-schema.json \
                --input <generated-research.json> \
                --strict
```

If the user-facing error is to be retried, surface specific paths:

```
❌ Research validation failed (3 issues):

  $.competitorsSurveyed[2].tokens.primary
    Expected hex pattern ^#[0-9a-fA-F]{6}$, got "rgb(10, 132, 255)"
    Fix: tokens-from should normalize to hex before write

  $.patternFrequency.hero_split_image_right
    Expected slug pattern ^[a-z][a-z0-9-]*$, got "hero_split_image_right"
    Fix: kebab-case slugs only (use hyphens, not underscores)

  $.competitorsSurveyed[0].pages[3].type
    Expected one of [marketing-landing, pricing, ...], got "homepage"
    Fix: 'homepage' is not in the enum; use 'marketing-landing'
```

## Reporting

```
✅ Research complete: B2B ed-tech
   Competitors surveyed: 8
   Pages captured:       40 (5 per competitor, standard depth)
   Patterns identified:  47 instances across 22 distinct patterns
   Templates identified: 18 distinct page types

   Universal conventions (≥75% adoption):
   - hero-split-image-right (80%)
   - feature-grid-3x2 (70%)
   - testimonial-grid (65%) [tier: common, just below universal]
   - pricing-3-tier (80%)
   - faq-accordion (85%)
   - footer-marketing (95%)

   Differentiation opportunities (<30% adoption):
   - hero-video-bg (10%) — visual products only
   - testimonial-video (5%) — high-trust contexts
   - feature-grid-bento (20%, rising trend) — modern brands

   Outputs:
   - design/research/b2b-ed-tech.md   (narrative)
   - design/research/b2b-ed-tech.pen  (visual comparison)
   - design/research/b2b-ed-tech.json (structured — for select commands)

📝 Next steps:
   /product:design:patterns:select  --informed-by design/research/b2b-ed-tech.json
   /product:design:templates:select --informed-by design/research/b2b-ed-tech.json
```

## Idempotency

Re-running for the same industry:

1. Default: append new competitors to the existing dataset (preserves
   prior surveys). Useful for tracking competitor changes over time.
2. `--replace` regenerates from scratch.
3. `--update` re-captures already-surveyed competitors with current
   data, leaving new ones alone (useful for "has the landscape
   shifted?").

## What this command does NOT do

- Does not perform business / market analysis (TAM, pricing
  strategy, positioning). It surfaces *design* conventions only.
- Does not score or rank competitors. The output is descriptive,
  not evaluative.
- Does not auto-bias selections. It produces data; downstream
  commands decide what to recommend.
- Does not capture private / authenticated parts of competitor
  products. Public marketing surface only.
- Does not handle anti-bot blocks gracefully — sites that detect
  headless browsers will fail. Fall back to user-provided
  screenshots via `--screenshots`.
