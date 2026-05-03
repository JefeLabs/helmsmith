# Market persona — Audit plane definitions

> Plane definitions consumed by `/audit` for the marketer
> persona. Covers editorial drift (voice/tone consistency
> across channels), SEO+AIO drift (search/AI-optimization
> health), and cadence drift (calendar adherence).
>
> Each plane below is a self-contained check sequence the audit
> dispatcher invokes. See `core/audit/audit.md` for the
> dispatch shell.

## Persona scope

| Plane | Name |
|-------|------|
| 8 | Editorial drift |
| 9 | SEO + AIO drift |
| 10 | Cadence drift |

## Plane 8 — Editorial drift

When `product/.pencil-editorial.json` exists, this plane detects
mechanical-style drift across generated artifacts. Editorial
drift is rarely a fail-build issue — inconsistent capitalization
or oxford-comma usage doesn't break functionality — but it
accumulates into the "feels unprofessional" smell that's hard to
fix later. Surface it early, before drift becomes the project's
de facto style.

Skip this plane when no `.pencil-editorial.json` exists. Skip
silently — don't nag teams to establish editorial style if they
haven't yet.

### Scope

Walk artifacts:

- `design/**/*.pen` — text strings embedded in design JSON
  (use `open-pencil extract-text` if available; fall back to
  heuristic JSON walk)
- `design/marketing/email/**/*.html` — text content (skip
  script/style blocks)
- `design/marketing/email/**/*.txt` — full content
- `design/research/*.md` — body text
- Generated React in `src/**/*.{tsx,jsx}` — string literals in
  JSX only (skip imports, variable names, function names,
  comments — code-side prose linting is out of scope)

Hand-edited code is out of scope (use ESLint with prose plugins,
Vale, or Alex for that). The audit catches drift in suite-
generated content.

### Lorem ipsum + low-fi exemption

Plane 8 recognizes lorem ipsum and skips those text strings.
Detection: any string starting with "Lorem ipsum" or matching
classical lorem patterns (consectetur, adipiscing, eiusmod,
tempor, dolor sit amet, etc.) is treated as placeholder, not
subject to editorial rules.

Additionally, `.pen` files marked as low-fi or wireframe via
metadata are exempted from Plane 8 entirely. The metadata flag
is set when `product/design/explore` produces a wireframe or when any
generation command runs with `--fidelity low`. When the file
gets promoted to hi-fi (re-generated with `--fidelity hi`),
Plane 8 starts applying normally.

This keeps the audit useful — drift detection catches real
drift, not the deliberate placeholder treatment that low-fi
exists to provide.

### 8a — Capitalization drift

For each capitalization rule in `.pencil-editorial.json`
(headings, buttons, navigation, productFeatures, uiLabels,
errorMessages):

- Walk artifacts. Detect the element class via heuristics —
  `.pen` frame names like `Button / primary` indicate buttons;
  `<button>` / `<h1>` tags indicate the obvious; React
  components named `Button` / `Heading` / `MenuItem` indicate
  their classes.
- For each detected element, verify casing matches the canonical
  rule.
- Aggregate violations:

```
[Plane 8a] INFO  Capitalization drift in 'buttons'
  Canonical:  sentence-case
  Detected:   12 violations across 8 files

  Examples:
    src/marketing/Hero.tsx:42       "Get Started"  → "Get started"
    src/marketing/Hero.tsx:67       "Learn More"   → "Learn more"
    design/templates/landing.pen    "Sign Up Free" → "Sign up free"

  Suggested fix: /audit --fix --plane 8a
  This generates batch find-replace operations for review.
```

Severity: info (drift, not breakage). Escalates to warn if the
same drift persists across consecutive audit runs without
resolution.

### 8b — Punctuation inconsistency

For each rule in `punctuation.{oxfordComma, emDash, ellipsis,
quotes, exclamationPoints}`:

- **Oxford comma**: scan sentences with 3+ list items. Verify
  presence/absence matches the canonical rule. Detection
  heuristic: phrases ending in `, X, and Y` (oxford) vs `, X
  and Y` (no oxford).
- **Em-dash**: scan for `—` characters. Verify
  spaced/unspaced matches canonical. Also catch double-hyphen
  `--` in prose contexts (should be em-dash) and stray hyphens
  used as em-dash.
- **Ellipsis**: scan for `…` (Unicode) and `...` (three
  periods). Verify match.
- **Quotes**: scan for typographic vs straight. Mixed usage in
  the same file is a flag (often paste-from-code introducing
  straight quotes into prose).
- **Exclamation points**: count exclamations per artifact. Flag
  artifacts with exclamation density above the canonical
  policy's threshold.

```
[Plane 8b] INFO  Em-dash inconsistency
  Canonical:  spaced ('word — word')
  Detected:   18 violations (unspaced em-dash 'word—word')
              7 violations (double-hyphen 'word--word')

  Files affected: 11

  Suggested fix: /audit --fix --plane 8b
```

### 8c — Terminology drift

Walk `terminology.preferred` map. For each canonical term, scan
artifacts for:

- The canonical form (count uses)
- Each variant in the values array (count uses)

When variants are detected, surface as drift:

```
[Plane 8c] INFO  Terminology drift: 'log in'
  Canonical:  log in (verb), login (noun)
  Detected variants in use:
    'log in':   34 instances (canonical verb)
    'login':    12 instances (when used as verb — incorrect)
    'sign in':  8 instances (different word, possibly intentional)

  Files affected: 14

  Note: 'sign in' may be a legitimate alternative term; if so,
  add to terminology.preferred or terminology.avoid as
  appropriate.

  Suggested fix: /audit --fix --plane 8c
```

Walk `terminology.avoid`. Each occurrence of an avoid-listed
word is a finding:

```
[Plane 8c] INFO  Avoid-list usage: 'click here'
  Detected:   6 instances
  Files:      design/templates/landing.pen, src/Marketing/CTA.tsx, ...

  Suggested fix: /audit --fix --plane 8c
  (replaces with descriptive link text per inclusion best practice)
```

### 8d — Abbreviation policy violations

Walk `abbreviations.{spellOutFirstUse, neverAbbreviate,
alwaysAbbreviate}`:

- **Spell-out-first-use**: when `spellOutFirstUse: true`, scan
  per-document for abbreviations that appear without their
  spelled-out version preceding them. Flag.
- **Never-abbreviate**: scan for abbreviated forms of words on
  the never list. Flag.
- **Always-abbreviate**: scan for spelled-out forms of words on
  the always list. Flag.

```
[Plane 8d] INFO  Abbreviation policy violations
  spellOutFirstUse: true

  Detected first-use abbreviations without prior spell-out:
    src/Marketing/Pricing.tsx:24    "API"  — no prior 'Application Programming Interface'
    src/Settings/Integrations.tsx:14 "SSO" — no prior 'Single Sign-On'

  neverAbbreviate: ['application', 'configuration']

  Detected:
    src/Components/Header.tsx:12    "App"           → "Application"
    src/Components/Settings.tsx:34  "Config"        → "Configuration"

  Suggested fix: /audit --fix --plane 8d
```

### 8e — Number / date format inconsistency

For each rule in `numbers` and `dates`:

- **Numbers under-ten**: when canonical is `spell-out`, flag
  numerals 1-9 used in prose contexts. When canonical is
  `numerals`, flag spelled-out forms in prose. When canonical
  is `context-dependent`, no automatic finding (it's a
  judgment call).
- **Currency**: scan currency strings for format consistency.
  Flag mixed thousands separators or decimal styles.
- **Date long format**: scan for date strings. Flag when
  detected format differs from canonical. Detection patterns:
  `Month DD, YYYY`, `DD Month YYYY`, `YYYY-MM-DD`, `M/D/YY`,
  `DD/MM/YY`.
- **Time format**: flag mixed 12h/24h usage in the same context
  (e.g. one list of times mixing both is high-friction).
- **Relative dates**: when canonical is `yes-when-recent` with
  threshold N days, flag absolute dates rendered for events
  within N days (and vice versa).

```
[Plane 8e] INFO  Date format inconsistency
  Canonical longFormat: "May 2, 2026"
  Detected formats:
    "May 2, 2026":     34 instances (canonical)
    "2026-05-02":      8 instances  (ISO; non-canonical)
    "5/2/2026":        3 instances  (ambiguous; non-canonical)

  Files affected: 9

  Suggested fix: /audit --fix --plane 8e
  Note: ISO dates may be intentional in technical contexts
  (logs, data tables). Review before applying batch fix.
```

### Severity model

All Plane 8 findings start at **info severity** because editorial
drift is rarely a build-blocker. Two escalation mechanisms:

- **Persistence escalation**: a finding present in 3+ consecutive
  audit runs without resolution escalates to **warn**. Drift
  that's surfaced and ignored becomes the project's de facto
  style; warn level signals "this is becoming canonical, decide
  intentionally."
- **`--strict-editorial` flag**: any Plane 8 finding becomes
  fail. Use in CI gates for projects where editorial consistency
  is product-critical (publications, education content,
  compliance-heavy documentation). Most projects shouldn't use
  this.

### `--fix` for Plane 8

Plane 8 fixes are **batch find-replace operations**, not
auto-applied:

```
[Plane 8a] Suggested fix:

  This will apply 12 find-replace operations across 8 files.
  Review before applying.

  src/marketing/Hero.tsx:
    Line 42:  "Get Started"   → "Get started"
    Line 67:  "Learn More"    → "Learn more"

  src/marketing/Footer.tsx:
    Line 18:  "Privacy Policy" → "Privacy policy"
    Line 19:  "Terms Of Service" → "Terms of service"

  ...

  Apply all? [y/N/per-file]
```

`per-file` lets the user accept fixes one file at a time.
`n` (default) prints the operations as a script the user can
run manually or pipe to a tool.

Plane 8c (terminology) fixes are more delicate because the
variants might be intentional (e.g. "sign in" used as a UI
label distinct from "log in" used as a verb). The fix output
flags ambiguous cases and asks per-decision.

Plane 8d (abbreviations) `--fix` doesn't auto-add spell-out-
first-use rewrites; that requires sentence-level rewriting that's
better done manually. Instead, the fix flags the documents
needing manual attention.

## Plane 9 — SEO + AIO drift

When `product/.pencil-seo.json` exists, this plane detects
SEO + AIO drift across generated artifacts. Drift here is
high-leverage to catch — search visibility compounds, and a
quarter of unaddressed drift accumulates into significant
ranking and citation losses.

Skip this plane when no `.pencil-seo.json` exists. Skip
silently — don't nag teams to establish SEO strategy if they
haven't yet.

### Scope

Walk artifacts:

- `design/templates/*.pen` — design source for page archetypes
- `design/pages/*.pen` — production page designs
- `src/app/**/*.{tsx,jsx}` — React source for generated pages
- `dist/**/*.html` — compiled HTML when build artifacts present
- `public/robots.txt`, `public/llms.txt`, `public/sitemap.xml`
  when present

Hand-edited pages are in scope when produced by the suite's
build pipeline; pure hand-crafted pages outside the suite's
generation path are out of scope.

### 9a — On-page SEO drift

Per archetype's `perArchetypeTargets` from the SEO strategy:

- **Title tag presence** — every page must have a `<title>`;
  flag missing
- **Meta description presence + length** — every page should
  have a meta description in the strategy's target length range;
  flag missing or out-of-range
- **H1 presence + uniqueness** — exactly one `<h1>` per page;
  flag pages with 0 or 2+
- **Heading cascade** — H1 → H2 → H3 should not skip levels;
  flag H1→H3 jumps without H2
- **Image alt text** — all `<img>` must have `alt` attributes;
  flag missing (this overlaps with accessibility audit but
  surfaces from SEO angle here)
- **Primary keyword presence** — pages targeting a primary
  keyword should have the keyword in title + H1 + first 100
  words; flag when missing in any required slot
- **Internal linking** — pages should have at least
  `internalLinksMin` internal links per archetype; flag low
  counts

```
[Plane 9a] INFO  On-page SEO drift across landing-page archetype
  Pages affected: 8

  Issues:
    - Missing meta descriptions: 3 pages
      src/app/features/saved-searches/page.tsx
      src/app/features/email-alerts/page.tsx
      src/app/features/exports/page.tsx
    - Missing H1: 1 page
      src/app/integrations/page.tsx
    - Heading cascade violations: 4 pages
      Most common: H1 → H3 jump (skipping H2)
    - Primary keyword not in title: 2 pages

  Suggested fix: /audit --fix --plane 9a
```

### 9b — Technical SEO drift

When build artifacts include performance data (Lighthouse
output, WebPageTest results, Core Web Vitals from
`@vercel/analytics`, `web-vitals` library output, etc.):

- **Core Web Vitals violations** — pages with LCP > target,
  INP > target, CLS > target. Flag with severity by amount of
  violation.
- **Mobile responsiveness** — viewport meta tag presence;
  responsive CSS media queries presence
- **Internal link integrity** — broken internal links (404 on
  same-domain references)
- **Canonical URL presence** — per `canonicalUrlsPolicy`; flag
  missing canonicals when policy is `explicit-everywhere`
- **robots.txt sanity** — robots.txt content matches strategy
  intent; flag unintentional blocks (e.g. blocking `Googlebot`
  unintentionally; blocking AI bots when strategy allows them)
- **sitemap.xml freshness** — sitemap.xml exists and contains
  the URLs the site actually serves; flag stale entries

```
[Plane 9b] WARN  Technical SEO drift
  Core Web Vitals violations: 4 pages
    src/app/dashboard/page.tsx       LCP 4.2s (target <2.5s)
    src/app/features/page.tsx        INP 280ms (target <200ms)
    ...

  robots.txt vs strategy mismatch: 1 finding
    Strategy allows GPTBot (--aio-emphasis heavy)
    robots.txt has User-agent: GPTBot Disallow: /
    This excludes the site from ChatGPT's training and
    citation corpus.

  Suggested fix: /audit --fix --plane 9b
  Note: Core Web Vitals fixes are code/infrastructure work;
        --fix surfaces the issues but doesn't auto-resolve.
```

### 9c — Content SEO drift

Strategy-driven content checks:

- **Word count target** — pages should meet `wordCountTarget`
  for their archetype; flag when content is significantly
  below (which weakens SEO ranking) or above (which sometimes
  signals padding)
- **Search intent alignment** — pages targeting transactional
  keywords should have transactional content (CTAs, forms,
  product info) prominently; pages targeting informational
  should have informational depth. Flag clear mismatches.
- **Structured data presence per archetype** — each archetype
  declares required Schema.org types; flag pages missing
  required schemas
- **Content cluster integrity** — when contentClusterStrategy
  is `pillar-cluster` or `hub-spoke`, verify pillar pages link
  to all clusters and clusters link back to pillar; flag
  broken cluster relationships

```
[Plane 9c] INFO  Content SEO drift
  Cluster topology violations: 2 findings

    Pillar /docs/saved-searches doesn't link to:
      /docs/saved-searches/email-alerts
      /docs/saved-searches/api-access
    These cluster pages exist but the pillar doesn't reference
    them — weakens topical authority signal.

  Structured data missing: 3 pages
    /pricing                     Product schema required, missing
    /docs/saved-searches/api     HowTo schema required, missing
    /docs/saved-searches         Article + FAQ required; FAQ missing

  Suggested fix: /audit --fix --plane 9c
```

### 9d — AIO drift

AIO-specific patterns from the strategy:

- **FAQ schema deployment** — when policy is
  `required-per-page`, flag pages missing FAQ schema
- **Definitive statement check** — when policy is `preferred`,
  scan for hedge words ("may", "might", "could potentially",
  "perhaps") in factual content; flag heavy hedging that
  weakens citation-worthiness
- **Comparison table presence** — when policy is
  `required-where-applicable`, scan for content that compares
  options and lacks a comparison table
- **Date-stamped facts** — when policy is `required`, scan for
  time-sensitive claims (data, statistics, "as of", year
  references) without explicit date stamps
- **Citation-friendly structure** — when policy is `required`,
  scan for narrative-heavy prose that lacks bullet points,
  numbered lists, or definitive headings; flag content that
  would be hard for an AI to extract specific answers from
- **Explicit definitions** — when policy is `required`, scan
  for jargon used without explicit inline definition; flag
  technical terms that aren't defined on first use

```
[Plane 9d] INFO  AIO drift
  Strategy: aioEmphasis = heavy
  Pages affected: 12

  FAQ schema missing where required: 6 pages
  Hedge-word density above threshold: 4 pages
    "/docs/saved-searches" uses "may", "might", "could"
    23 times in 800 words — weakens citation-worthiness.
    Specific claims preferred: "Saved searches are reusable
    filters" beats "Saved searches may function as reusable
    filters in some implementations."
  Comparison table missing where applicable: 2 pages
  Date-stamped facts missing: 7 instances of bare year/data
    claims without explicit dates

  Suggested fix: /audit --fix --plane 9d
  (Hedge-word and definition fixes typically need manual
   review — auto-rewrite produces inconsistent voice.)
```

### 9e — Crawler accessibility drift

- **robots.txt vs strategy mismatch** — strategy declares
  allowed/blocked bots; robots.txt should reflect this
- **llms.txt presence + content** — when strategy has
  `aio.crawlerAccessibility.llmsTxtPath`, file should exist
  at that path with declared allowed bots
- **Structured data validation** — JSON-LD blocks should
  validate against Schema.org. Use Google's Structured Data
  Testing Tool or Schema.org validator; flag broken schemas
- **Sitemap reachability** — sitemap.xml should be referenced
  in robots.txt and accessible from the declared path

```
[Plane 9e] WARN  Crawler accessibility drift
  llms.txt missing
    Strategy declares /llms.txt should exist with GPTBot,
    ClaudeBot, PerplexityBot allowed
    File not found in dist/llms.txt
    Action: create file matching strategy declaration

  robots.txt vs strategy mismatch: 1 finding
    Strategy: ClaudeBot allowed
    robots.txt: ClaudeBot not explicitly mentioned
    (Default behavior is allow when not mentioned, but
     explicit declaration is preferred)

  Structured data validation errors: 3 instances
    src/app/pricing/page.tsx       Product schema missing required price
    src/app/blog/post-1/page.tsx   Article schema missing dateModified
    src/app/contact/page.tsx       LocalBusiness schema malformed address

  Suggested fix: /audit --fix --plane 9e
```

### Severity model

- **9a, 9c, 9d**: start at **info** (drift, not breakage).
  Persistence escalation to warn after 3+ consecutive audits
  without resolution.
- **9b, 9e**: start at **warn** (technical issues + crawler
  accessibility have higher business impact). Core Web Vitals
  violations escalate to fail with `--strict-cwv` flag.

`--strict-seo` flag: any Plane 9 finding becomes fail. Use in
CI gates for projects where SEO is product-critical.

### `--fix` for Plane 9

- **9a (on-page SEO)**: batch find-replace + add operations.
  Adding missing meta descriptions, fixing heading cascades,
  adding alt-text placeholders for review.
- **9b (technical)**: surfaces issues but doesn't auto-fix.
  Core Web Vitals fixes are code/infrastructure work.
- **9c (content SEO)**: structured-data injections can be
  automated; word-count and intent-alignment require manual
  review.
- **9d (AIO)**: hedge-word and definition fixes need manual
  review (voice consistency); FAQ schema injection can be
  automated.
- **9e (crawler accessibility)**: robots.txt and llms.txt
  generation is automatable; structured data validation
  fixes per error.

## Plane 10 — Cadence drift

When `product/.pencil-marketing-calendar.json` exists, this
plane detects cadence drift across marketing channels. The
calendar declares per-channel cadence targets (X: 5 posts/week,
newsletter: weekly, etc.); this plane counts actual publish
events from each channel's metadata files and compares against
the targets. Gaps below floor and overload above ceiling both
surface.

Skip this plane silently when no
`.pencil-marketing-calendar.json` exists. Don't nag teams to
establish a calendar if they haven't yet.

### Why cadence drift matters

Per the calendar workflows: marketing teams that maintain
consistent cadence build compounding effect; teams with
sporadic activity (3 launches in a quarter, 9 quiet weeks)
underperform teams with steady weekly rhythm. Cadence drift —
silently slipping below the floor target on a channel — is
how compounding gets lost without anyone noticing.

This plane is the formal mechanism. The cadence target lives
in the calendar; the audit measures actual publish events
against it; drift surfaces as findings.

### Scope

Walk publish-event metadata across channel-specific paths:

- **Email**: `design/marketing/email/**/*.json` (each
  generated email's metadata records a publish/send date)
- **Blog**: project-specific (often `content/blog/*.md`,
  `src/app/blog/[slug]/page.tsx`, or whatever the team's
  blog source uses; document the path in
  `.pencil-marketing-calendar.json`'s `channelCadenceTargets`
  per-channel `sourcePath` field)
- **Social organic**: `design/marketing/social/**/*.json`
  (per-platform per-post metadata)
- **Paid ads**: `design/marketing/ads/**/*.json` (campaign-
  level metadata; cadence applies to campaign launches not
  per-impression)
- **PR**: `design/marketing/pr/releases/*.json`

For each artifact, extract:
- Publish date or scheduled-for date
- Channel (derived from path)
- Status (published / scheduled / draft) — only count
  published + scheduled-active toward cadence

### 10a — Channel cadence drift below floor

For each channel with a declared `channelCadenceTargets[<channel>].floor`:

- Compute actual publish count over the relevant period
- Compare to floor
- When actual < floor → **drift below floor**, severity warn
- When actual < 50% of target → **severe drift**, severity fail

```
[Plane 10a] WARN  Cadence drift below floor
  Period: last 4 weeks (2026-04-05 to 2026-05-03)

  Channel: social-x
    Target:    5/week
    Floor:     3/week
    Actual:    2.5/week (10 posts in 4 weeks)
    Status:    drift below floor — fewer X posts than the
               calendar's minimum cadence
    Owner:     <documented owner>

  Channel: email-newsletter
    Target:    weekly (1/week = 4 in this period)
    Floor:     1 per 2 weeks (minimum 2 in 4 weeks)
    Actual:    1 (last newsletter shipped 28 days ago)
    Status:    drift below floor — newsletter cadence broken;
               last issue 28 days ago

  Channel: blog
    Target:    2/week (8 in 4 weeks)
    Floor:     1/week (4 in 4 weeks)
    Actual:    2 (blog posts in 4 weeks)
    Status:    severe drift — actual is 25% of target

  Suggested fix: review calendar capacity assumptions; if
  capacity is constrained, reduce targets in the calendar.
  If capacity is honest and cadence is the issue, surface
  to channel owners for catch-up production.
```

### 10b — Channel cadence overload above ceiling

For each channel with declared `channelCadenceTargets[<channel>].ceiling`:

- Compute actual publish count
- When actual > ceiling → **overload**, severity warn
- When actual > 150% of ceiling → **severe overload**

Overload is rarer than drift but matters — sustained over-
posting damages engagement (followers fatigue), erodes
production quality, and signals capacity strain that will
fail later.

```
[Plane 10b] WARN  Cadence overload above ceiling
  Period: last 2 weeks

  Channel: social-x
    Ceiling:   8/week (16 in 2 weeks)
    Actual:    23 posts in 2 weeks
    Status:    severe overload — 144% of ceiling
    Owner:     <documented owner>

  Likely causes:
    - Multiple campaign overlaps producing redundant posts
    - Production team batching to meet end-of-period target
      after earlier drift
    - New person/agency overshooting cadence

  Suggested fix: review last 2 weeks' posts for
  consolidation opportunities; redistribute scheduled
  upcoming posts; check if overlapping campaigns can
  reduce social emphasis.
```

### 10c — Schedule conflicts (multi-publish-same-day)

Conflicts surface when multiple high-attention items publish
the same day:

- Two emails to the same audience same day = conflict
- Press release + major social campaign + product launch all
  same day = high-stress coordination point that can fail

When `monthlyCalendar.scheduledItems` has multiple high-
priority items on same date, surface for review:

```
[Plane 10c] INFO  Schedule conflicts in monthly calendar
  Date: 2026-05-15

  Items:
    - email-newsletter (newsletter-2026-W20)
    - press-release (saved-searches-launch)
    - social-campaign (launch-saved-searches launch-day burst)
    - launch-campaign (saved-searches launch-day execution)

  All four items publish the same day. This is the
  intentional launch-day coordination per
  launch-campaign workflow. Verify the launch coordinator
  has runbook coverage and bandwidth.

  Conflict severity: low (intentional coordination)

  ---

  Date: 2026-05-22

  Items:
    - email-newsletter (newsletter-2026-W21)
    - email-promotional (seasonal-back-to-school-teaser)

  Two emails to overlapping audiences same day. Consider
  spacing or audience-segmenting.

  Conflict severity: warn
```

### 10d — Calendar staleness

When `lastUpdatedAt` is older than the conventional refresh
cadence (90 days for annual, 7 days for monthly during active
period), surface as drift:

```
[Plane 10d] WARN  Calendar staleness
  Annual calendar last updated: 2025-12-15 (139 days ago)
  Recommended refresh cadence: 90 days

  Quarterly themes may no longer reflect current strategic
  focus. Run /workflows:manage start market:marketing-calendar-annual
  to refresh, or note explicitly that the existing calendar
  is current for the remaining year.

  ---

  Monthly calendar last updated: 2026-04-12 (21 days ago)
  Recommended refresh cadence: 28 days max
  Status: approaching staleness; refresh recommended within
  next week.
```

### 10e — Capacity-vs-actual mismatch

When `capacityAssumptions.marketingFTE` no longer reflects
reality (team grew or shrunk), the cadence targets may no
longer be calibrated:

```
[Plane 10e] INFO  Capacity assumption review
  Last reviewed: 2025-11-10 (175 days ago)
  Recommended review cadence: every 90 days, or upon team change

  Verify capacity assumptions still hold. If team has grown,
  calendar can support higher cadence (consider raising
  targets). If team has shrunk, current targets may be
  unsustainable (consider reducing targets before drift
  fires).
```

### Severity model

- **10a**: warn (drift below floor); fail (severe drift, <50%
  of target)
- **10b**: warn (overload above ceiling); fail (severe
  overload, >150%)
- **10c**: info (intentional conflicts) or warn (unintentional)
- **10d, 10e**: info (housekeeping reminders); escalates to
  warn after threshold

`--strict-cadence` flag: any Plane 10 finding becomes fail.
Use in environments where cadence consistency is a hard
commitment (e.g. agency-managed accounts with SLAs).

### `--fix` for Plane 10

Plane 10 surfaces findings but doesn't auto-fix. Cadence
problems are operational, not artifact problems:

- Drift below floor: production work needed (write the missed
  posts)
- Overload above ceiling: redistribution decisions needed
- Schedule conflicts: review and reschedule
- Calendar staleness: run the calendar workflow to refresh
- Capacity mismatch: human judgment on whether to adjust
  targets or hire

The audit's job is detection; resolution is the team's job.

