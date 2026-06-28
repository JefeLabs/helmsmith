---
description: Generate a press release in news-genre format. Press voice (third-person, formal, AP-style) regardless of brand voice. Multiple release templates (product-launch, funding, leadership-change, partnership, milestone). Embargo handling, boilerplate from registry, spokesperson quotes from registry. Output is .md (the release text) + .json (metadata for distribution and audit).
argument-hint: <release-slug> [--type product-launch|funding|leadership-change|partnership|milestone|generic] [--embargo <ISO>] [--spokesperson <name-or-slug>] [--quote-style brand-flavored|formal] [--informed-by <brief-slug>] [--wire <prnewswire|businesswire|globenewswire|cision|einpresswire|direct>] [--distribution-date <ISO>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Generate a press release in news-genre format. Press voice
(third-person, formal, AP-style) regardless of brand voice.
Spokesperson quotes inside the release can reflect brand voice
somewhat; surrounding prose stays genre-locked.

Output is two files:

- `design/marketing/pr/releases/<slug>.md` — the release text
  formatted for wire submission and journalist distribution
- `design/marketing/pr/releases/<slug>.json` — metadata for
  audit, distribution tracking, calendar coordination

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/pr/_context.md`, `product/.pencil-tone.json`, and
   (when established) `product/.pencil-editorial.json` and
   `product/.pencil-seo.json`.
2. Read `product/.pencil-brand.json` for industry, audience,
   `companyType` (private/public), `industryRegulation`.
3. Read `design/marketing/pr/boilerplate.json` if it exists.
   When missing, prompt to create — most fields can be inferred
   from brand JSON, but spokesperson registry and current stats
   require user input.
4. Resolve inputs:
   - First positional: release slug (e.g.
     `saved-searches-feature-launch-q2-2026`,
     `series-b-funding-may-2026`)
   - `--type` — release template:
     - `product-launch`: feature/product release
     - `funding`: fundraising announcement
     - `leadership-change`: executive hire or departure
     - `partnership`: announced partnership
     - `milestone`: customer/revenue/anniversary milestone
     - `generic`: news that doesn't fit a template; minimal
       structure scaffold
   - `--embargo <ISO>` — embargo lift time (release distributes
     under embargo before this date). When omitted, release is
     for immediate distribution.
   - `--spokesperson <name-or-slug>` — primary spokesperson for
     the quote. Must match an entry in `boilerplate.json`. When
     omitted, uses the boilerplate's first spokesperson with
     topic-fit.
   - `--quote-style brand-flavored|formal` — default
     `brand-flavored` (quotes can reflect brand voice within
     reason). `formal` produces conventional executive-formal
     quotes.
   - `--informed-by <brief-slug>` — context (relevant brief)
   - `--wire <service>` — intended distribution channel; recorded
     in metadata for audit
   - `--distribution-date <ISO>` — when the release will go out.
     Defaults to today; informs the dateline.
5. Compliance pre-flight:
   - When `companyType: "public"` AND `--type` is in
     {`funding`, `leadership-change`, `milestone`} (potentially
     material), surface SEC Reg FD considerations and prompt
     user to confirm legal review path before continuing.
   - When `industryRegulation` is set (financial-services,
     healthcare, etc.), surface required disclaimers for the
     release type and add disclaimer placeholders to the body.

## Release structure (news-genre standard)

All press releases follow this structural template, varying
content per `--type`:

```
[FOR IMMEDIATE RELEASE | EMBARGOED UNTIL <DATE/TIME/TIMEZONE>]

<HEADLINE — AP-style title case or sentence case per editorial
style; concrete and specific; under 12 words ideal>

<Subhead — one sentence supporting the headline; can extend the
news angle or add specificity>

<DATELINE — CITY, STATE, [Country if outside US] — Month Day, Year>
— <Lead paragraph: 5W+H — who, what, when, where, why, how —
in 1-3 sentences. Most-important fact first.>

<Body paragraph 2 — supporting details, context, what's new
about this. 2-4 sentences.>

<Body paragraph 3 — additional context, market significance,
what changes for customers/users.>

"Spokesperson quote that adds the human angle the prose can't,"
said <Spokesperson Name>, <title> at <Company>. "A second
sentence that extends or contextualizes the first."

<Body paragraph 4 — additional details, supporting facts,
related context.>

<Optional: second spokesperson quote when warranted — partnership
announcements often have a quote from the partner; major customer
wins may have a customer quote.>

<Body paragraph 5 — closing context, broader implications,
what's next.>

<Optional: forward-looking-statement disclaimer for public
companies>

About <Company>
<Boilerplate from boilerplate.json>

Media Contact:
<Name>
<Title>
<Email>
<Phone>

###
```

The `###` at the end is journalism convention indicating end
of release. Wire services expect it.

## Per-`--type` content

### `product-launch`

Headline pattern: `<Company> launches <product/feature> [for <audience>] [to <outcome>]`

Examples:
- "Acme launches saved searches for engineering teams to cut hours from weekly workflow"
- "Acme adds AI-powered code review to its developer platform"

Lead structure: announce the launch, identify the product,
identify the audience, name the most-important benefit.

Body progression:
1. What it is (product description, key features)
2. Why now (market context, customer need)
3. How it works (high-level mechanic, not deep technical detail)
4. Spokesperson quote (vision/strategy angle)
5. Customer/beta-user evidence (when available)
6. Availability (pricing tier, GA date, geographic rollout)

### `funding`

Headline pattern: `<Company> raises $<amount> [Series X | seed | bridge] [led by <lead investor>] [to <use of funds>]`

Examples:
- "Acme raises $20M Series B led by Acme Ventures to expand AI productivity platform"
- "Acme closes $5M seed round to build agent-assisted developer tooling"

Lead structure: amount, round letter, lead investor, use of
funds in 1-3 sentences.

Body progression:
1. Funding details (round, lead, participating investors,
   total raised to date)
2. Use of funds (specific: hiring, product expansion, geographic
   expansion)
3. Spokesperson quote (CEO typically; vision and strategic
   direction)
4. Investor quote (lead investor explains why they invested —
   third-party validation)
5. Company context (current customer count, growth metrics,
   product traction — pull from boilerplate)
6. Forward-looking-statement disclaimer (public companies)

When `companyType: "public"`, funding announcements have heavy
disclosure overlay; flag for legal review.

### `leadership-change`

Headline pattern: `<Company> appoints <Name> as <Role> [from <prior company>]`

Examples:
- "Acme appoints Jane Doe as Chief Revenue Officer"
- "Acme names former Stripe executive John Smith CTO"

Lead structure: appointment fact, name, role, prior company
when notable.

Body progression:
1. Appointment context (when starting, what role, reporting line)
2. Background (prior company, achievements, relevant experience)
3. Spokesperson quote (existing exec — CEO welcoming; or
   board chair for CEO transitions)
4. New executive's quote (their statement on joining)
5. Company context (why this hire now, what it signals about
   strategy)

For departures, the structure inverts: announce the departure,
acknowledge contributions, note transition plan, name successor
when known.

### `partnership`

Headline pattern: `<Company> partners with <Partner> to <outcome>` or `<Company> and <Partner> announce <partnership type>`

Examples:
- "Acme partners with Stripe to streamline developer payment workflows"
- "Acme and OpenAI announce integration for agent-assisted coding"

Lead structure: announce the partnership, identify both parties,
name the joint outcome or product.

Body progression:
1. What the partnership creates (joint product, integration,
   reseller agreement, etc.)
2. Why both companies (mutual benefit; what each brings)
3. Spokesperson quote from each company (one each is standard;
   gives both brands proper representation)
4. Customer benefit (what changes for users)
5. Availability (when, where, pricing if relevant)

### `milestone`

Headline pattern: `<Company> reaches <milestone>` or `<Company> celebrates <anniversary> [with <statistic>]`

Examples:
- "Acme reaches 10,000 customer milestone in second year"
- "Acme celebrates two years with $50M ARR and 85 employees"

Lead structure: announce the milestone with specific number and
context.

Body progression:
1. The milestone (specific number; comparison to prior period)
2. What it represents (growth rate, market position, etc.)
3. Spokesperson quote (CEO typically; reflective and forward)
4. Customer/employee/investor recognition (whom this milestone
   credits)
5. What's next (preview of upcoming roadmap or growth plans)

For `companyType: "public"` milestones touching financials,
flag for SEC compliance review.

### `generic`

When the release doesn't fit a template, generate a minimal
structural scaffold (headline + subhead + lead + 3 body paragraphs
+ quote + boilerplate) and prompt the user to fill in
appropriately.

## Spokesperson quotes — the human angle

Spokesperson quotes are the highest-leverage element of a press
release. Journalists frequently lift quotes verbatim into their
articles; the surrounding prose may be paraphrased or rewritten.

**Quote construction rules**:

1. **1-3 sentences max**. Long quotes don't get used.
2. **Add a perspective the prose can't** — the prose says what
   happened; the quote says why it matters or how it feels
3. **Specific over generic** — "We've been listening to teams
   who run 50+ saved searches per week" beats "We're committed
   to user experience"
4. **Quotable phrasing** — ideally produces a sentence a
   journalist can lift as their article's pull quote
5. **Avoid corporate buzzwords** — "leverage", "synergy",
   "best-in-class", "industry-leading" without substantiation
   make quotes unusable
6. **Voice modulation** per `--quote-style`:
   - `brand-flavored` (default): quote can reflect brand voice
     within news-genre constraints
   - `formal`: conventional executive-formal phrasing

Example for the saved-searches launch (brand-flavored, warm-builder
voice CEO):

```
"We kept hearing the same feedback: 'I'm typing the same filter
combination 47 times this week,'" said Jane Doe, CEO and
co-founder of Acme. "Saved searches is the smallest possible
fix for that. The win is hours back in the week."
```

Same release, formal-style:

```
"We are pleased to introduce saved searches, a feature
designed to address a long-standing customer need around
filter reusability," said Jane Doe, CEO and co-founder of
Acme. "We expect this enhancement to deliver meaningful
productivity gains for our user base."
```

The brand-flavored version is more quotable. The formal version
is safer for highly regulated contexts where any voice-flavor
risks compliance review pushback.

## Embargo handling

When `--embargo` is set:

1. The release header reads
   `EMBARGOED UNTIL <DATE/TIME/TIMEZONE>` instead of
   `FOR IMMEDIATE RELEASE`
2. Distribution metadata records the embargo
3. The release content remains complete — embargoed releases are
   the full final text, just delivered ahead of public lift
4. Companion `journalist-outreach` pitches (run separately) note
   the embargo explicitly

Embargo timezone is critical — `EMBARGOED UNTIL May 5, 2026,
9:00 AM ET` is unambiguous; `EMBARGOED UNTIL May 5` is not.

## Forward-looking-statement handling

When `companyType: "public"` AND the release contains
projections, guidance, or forward-looking claims, append the
forward-looking-statement disclaimer from `boilerplate.json`'s
`forwardLookingStatement` field.

The command flags forward-looking content automatically by
scanning for trigger phrases:
- "expects to", "plans to", "intends to"
- "projected", "anticipated", "expected"
- "will be", "will deliver", "is expected to"
- specific future numbers without "as of [historical date]"

When detected, the disclaimer is added; user reviews placement.

## Voice + editorial check

Standard pass with PR-specific layer:

- **Press voice compliance**: third-person prose throughout
  (except inside spokesperson quotes); past-tense announcement
  phrasing; formal register; active voice preferred
- **Editorial pass**: capitalization, punctuation per editorial
  style — but with PR-specific defaults (AP style is the news
  industry baseline; if `.pencil-editorial.json` references
  `ap`, full alignment; otherwise AP overrides for press
  releases specifically)
- **Compliance pass**: industry-regulation disclaimers present
  when required; forward-looking-statement disclaimer when
  triggered; embargo header correct

## Generate metadata

```jsonc
{
  "kind": "press-release",
  "slug": "saved-searches-feature-launch-q2-2026",
  "type": "product-launch",
  "createdAt": "2026-05-02T18:00:00Z",
  "distributionDate": "2026-05-15",
  "embargo": null,
  "headline": "Acme launches saved searches for engineering teams to cut hours from weekly workflow",
  "subhead": "New feature lets users save filter combinations once and reapply with one click",
  "dateline": {
    "city": "New York",
    "state": "NY",
    "country": "USA",
    "date": "May 15, 2026"
  },
  "spokespeople": [
    {
      "slug": "jane-doe",
      "name": "Jane Doe",
      "title": "CEO and Co-founder",
      "quoteStyle": "brand-flavored"
    }
  ],
  "distribution": {
    "wire": "businesswire",
    "directOutreach": ["techcrunch", "the-information"],
    "newsroom": true
  },
  "compliance": {
    "companyType": "private",
    "regFDApplicable": false,
    "industryRegulation": null,
    "requiredDisclaimers": [],
    "forwardLookingStatement": false,
    "legalReviewStatus": "pending"
  },
  "seo": {
    "primaryKeyword": "saved searches",
    "structuredData": ["NewsArticle", "Organization"],
    "newsroomUrl": "https://acme.com/newsroom/saved-searches-launch"
  },
  "calendarCoordination": {
    "campaignSlug": "launch-saved-searches-q2-2026",
    "anchorDate": "2026-05-15",
    "supportingActivities": [
      "marketing/email/promotional/saved-searches-launch.json",
      "marketing/ads/landing/launch-saved-searches-q2-2026-pairing.json",
      "marketing/social/campaigns/launch-saved-searches-q2-2026.json"
    ]
  }
}
```

The `calendarCoordination` field links the release to a campaign-
slug used by other marketing artifacts. The launch-campaign
workflow (Session 3-B) reads this to coordinate the press release
with email + ads + social timing.

## Reporting

```
✓ Press release generated: saved-searches-feature-launch-q2-2026

Files:
  design/marketing/pr/releases/saved-searches-feature-launch-q2-2026.md
  design/marketing/pr/releases/saved-searches-feature-launch-q2-2026.json

Type:           product-launch
Distribution:   May 15, 2026 (immediate; no embargo)
Wire:           Business Wire (intended)
Primary spokesperson: Jane Doe (CEO and Co-founder)
Quote style:    brand-flavored

Compliance:
  Company type:           private (no SEC Reg FD trigger)
  Industry regulation:    none
  Forward-looking:        not detected
  Legal review:           pending — recommend before distribution
  FTC disclosure:         not required (organic announcement)

Voice + editorial:
  Press voice:            ✓ third-person throughout prose
  Editorial style:        ✓ AP-aligned (consistent with .pencil-editorial.json)
  Spokesperson quote:     warm-builder flavor preserved within
                          news-genre constraints

SEO/AIO:
  NewsArticle schema:     populated
  Newsroom URL:           https://acme.com/newsroom/saved-searches-launch
  Will be archived in:    /product:design:templates:newsroom (run separately)

Calendar coordination:
  Campaign slug:          launch-saved-searches-q2-2026
  Anchor date:            May 15, 2026
  Linked artifacts:       email, ads-landing pairing, social campaign

Action items:
  1. Read the .md file end to end; the press voice should sound right
  2. Legal review before distribution (especially for funding/leadership/milestone types)
  3. Spokesperson approval — confirm Jane Doe approves the quote
  4. Companion journalist outreach: /market:pr:journalist-outreach
  5. Newsroom page archival: /product:design:templates:newsroom (or update
     existing newsroom with this release linked)
  6. Wire submission via Business Wire's portal (not automated by suite)
```

## Idempotency

Re-running with the same slug overwrites both .md and .json.
For variants (e.g. embargoed vs non-embargoed versions of the
same news), use distinct slugs.

When `boilerplate.json` is updated after a release was generated,
the release is NOT auto-updated. Re-run the command to refresh
boilerplate text in the release. Audit Plane 9c will eventually
catch boilerplate drift across releases.

## What this command does NOT do

- **Does not submit to wire services.** Wire submission happens
  via the wire's portal or PR-tooling integration outside the
  suite. The metadata records intent.
- **Does not handle journalist outreach.** Use
  `/market:pr:journalist-outreach` for personalized pitch
  emails to specific journalists.
- **Does not do crisis comms.** Crisis releases need real-time
  human judgment, legal involvement, and tonal calibration that
  templates can't supply. Engage specialized PR counsel.
- **Does not perform legal review.** Compliance fields flag
  considerations; counsel reviews before distribution.
- **Does not auto-publish to the newsroom.** Newsroom page is
  generated separately by `/product:design:templates:newsroom`; this
  command's release becomes input to that template.
- **Does not measure earned media coverage.** Coverage tracking
  is downstream PR-tooling work (Cision, Muck Rack, etc.).
