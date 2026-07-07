# PR — Medium Context (`market/pr/`)

> Read this in addition to `product/strategy/_context.md`,
> `market/_context.md`, `product/.pencil-tone.json`, and (when
> established) `product/.pencil-editorial.json` and
> `product/.pencil-seo.json` whenever any `/market:pr:*` command
> runs.
>
> PR is the marketing namespace's most genre-constrained medium.
> Press releases, media kits, and journalist outreach follow
> conventions inherited from a century of newswire and journalism
> practice. Diverging from those conventions doesn't read as
> creative — it reads as amateur, and journalists ignore it.

## Why PR is different from other marketing

Email reaches an opted-in audience. Ads reach targeted audiences.
Social reaches followers + algorithmic discovery. **PR reaches
journalists, analysts, and (increasingly) AI search engines** —
intermediaries who decide whether and how to amplify the brand's
message to a much larger audience.

This produces concrete differences:

- **Voice is genre-fixed**, not brand-flexible. Press releases
  are written in third-person news style regardless of brand
  voice. "Acme today announced..." not "We just shipped..."
  Spokesperson quotes inside press releases can reflect brand
  character somewhat (quotes are personal speech), but the
  surrounding prose is genre-locked.
- **Distribution is mediated**, not direct. Wire services (PR
  Newswire, Business Wire, GlobeNewswire) charge to distribute
  to journalist networks; direct outreach reaches individual
  journalists; the brand's newsroom is the only owned-channel
  piece. Each requires different formatting and conventions.
- **Compliance density is high** — SEC disclosure rules for
  public companies, embargo conventions, boilerplate
  requirements, spokesperson approval workflows, forward-
  looking-statement disclaimers, FTC rules for paid placements.
- **SEO leverage is meaningful** — wire-service releases rank
  well for branded queries; archived on the brand's newsroom
  they build domain authority; AI search engines cite press
  releases as authoritative brand sources.

## The press voice — independent of brand voice

The `.pencil-tone.json` voice is the brand's voice across email,
ads, social, and product copy. **Press releases use a separate
press voice** that's largely independent of brand character.

Press voice characteristics:

- **Third-person consistently**. "Acme announced", not "We
  announced". Even when "we" appears in spokesperson quotes,
  the surrounding prose stays third-person.
- **Past tense for the announcement**. "Acme today announced..."
  even though the announcement is happening now.
- **News-lead structure** — most-important fact first, supporting
  details after. Inverted-pyramid journalism.
- **Formal register** independent of brand register. A casual,
  warm brand voice still produces formal press releases.
- **Quotable quotes** — spokesperson quotes are 1-3 sentences,
  designed to be lifted into journalist-written articles. They
  carry the human angle the surrounding prose can't.
- **Specific facts over abstract claims**. "Acme raised $20M in
  Series B led by Acme Ventures" beats "Acme secured significant
  funding". Journalists can't use abstract claims; they can use
  specific facts.

This isn't a stylistic preference — it's a genre requirement.
Press releases that read like blog posts get ignored by the
journalists they're trying to reach.

### Voice modulation table for PR

| Concern              | Brand voice (`.pencil-tone.json`) | PR voice (this file) |
| -------------------- | --------------------------------- | -------------------- |
| Person               | Brand-determined (often "we")     | Always third-person  |
| Tense                | Brand-determined                  | Past tense for announcements |
| Register             | Brand-determined (warm/formal/etc.) | Always formal       |
| Sentence length      | Brand-determined                  | Mixed; lead is short and dense |
| Active voice         | Often preferred                   | Strongly preferred (journalism convention) |
| Adjectives           | Brand-modulated                   | Sparse; specific facts over decorative language |
| First-person plural  | Brand-determined                  | Reserved for spokesperson quotes only |

The press voice is **applied within the press release prose**.
The brand voice **may appear inside spokesperson quotes** when
that fits — a warm-builder brand whose CEO quote sounds warm
reads more authentic than a CEO quote that sounds like the prose
around it.

## Compliance — the layered overlay

PR carries the heaviest compliance density of any marketing
medium because the audience includes regulated entities
(public-company shareholders via SEC filings, healthcare via
FDA, financial via SEC/FINRA).

### Public company disclosure (US — SEC Reg FD)

Public companies cannot disclose material non-public information
selectively. If a press release would constitute material
disclosure, it must be disseminated broadly (wire service +
8-K filing typically) before any selective discussion (analyst
briefings, journalist exclusives).

Material disclosure examples:
- Earnings results before public reporting
- M&A activity
- Material customer wins/losses
- Significant leadership changes
- Material litigation outcomes

When the brand JSON declares `companyType: "public"` and the
release type is in the material-disclosure list, the command
flags compliance considerations and surfaces the SEC implications
for review by counsel.

### Forward-looking statements

Public companies must include forward-looking-statement
disclaimers when releases include projections, guidance, or
forward-looking claims:

```
Statements in this release that are not historical facts
constitute forward-looking statements within the meaning of
the Private Securities Litigation Reform Act of 1995. These
statements involve risks and uncertainties that could cause
actual results to differ materially. Factors that could cause
or contribute to such differences include [...]. Acme
undertakes no obligation to update forward-looking statements.
```

The exact language varies by jurisdiction and counsel preference;
the command includes a placeholder version that legal-review
finalizes.

### Industry-specific overlays

Same as paid ads (per `market/ads/_context.md`):
- **Financial services** — SEC, FINRA, FCA, ESMA rules apply to
  any release containing performance claims, projections, or
  fund commentary
- **Healthcare** — FDA fair-balance rules apply to drug-related
  releases; HIPAA implications when patient data is referenced
- **Cannabis** — state-specific restrictions; many wire services
  refuse cannabis releases regardless of local law
- **Public-sector contracts** — disclosure rules for government
  contractor announcements

When `industryRegulation` is set in brand JSON, the press release
metadata flags it and prompts for required disclaimer review.

### Embargo conventions

Embargoes — distributing a press release to journalists ahead
of publication with an agreed lift time — let coverage land
synchronized at announcement time. Embargo etiquette:

- **Embargo offer is explicit** — emails to journalists state
  "Embargoed until [date/time/timezone]"; never assumed
- **Journalists can decline** — refusing the embargo means
  receiving the release at public lift time
- **Breaking embargo** — when a journalist publishes early,
  options are to lift the embargo for everyone (acceptable
  damage) or pursue with the publication (rarely worth it)
- **Embargo windows** — 24-72 hours typical; longer for
  complex stories needing analyst briefings; shorter for
  time-sensitive news

The press-release command's metadata captures embargo intent
and lift time when applicable.

### FTC rules — paid placements

When a brand pays for placement (sponsored content disguised as
news, paid analyst reports presented as independent), FTC rules
require disclosure. The press release command flags any release
metadata indicating paid placement and includes "Sponsored" or
"Paid placement" in distribution metadata for journalist review.

## Spokesperson registry + boilerplate

The boilerplate is the recurring legal-and-marketing footer that
appears at the end of every press release:

```
About Acme

Acme is the [category] for [audience]. Founded in [year], the
company [description, 1-2 sentences]. Acme is headquartered in
[location] with offices in [other locations]. For more
information, visit acme.com.

Media Contact:
Press Officer Name
press@acme.com
[phone]
```

The spokesperson registry tracks who can speak on behalf of the
brand, and for what:

- **CEO** — strategic direction, fundraising, partnerships,
  major customers (with permission)
- **CTO/CPO** — product technology, engineering achievements,
  technical announcements
- **CFO** — financial results, fundraising, M&A
- **Customer-facing leaders** — customer wins, marketing
  programs, partnerships

These are persisted in `design/marketing/pr/boilerplate.json`
(see schema below). Centralizing prevents drift — the Q3
release saying "5,000 customers" while the Q4 release says
"8,000 customers" because someone forgot to update.

### `boilerplate.json` schema (lightweight)

```jsonc
{
  "version": 1,
  "lastUpdated": "2026-05-02",
  "brand": {
    "legalName": "Acme Inc.",
    "displayName": "Acme",
    "category": "AI productivity tools for engineering teams",
    "audience": "engineering and product teams at growing software companies",
    "founded": "2024",
    "headquarters": "New York, NY",
    "offices": ["New York, NY", "San Francisco, CA"],
    "website": "https://acme.com",
    "currentStats": {
      "customerCount": "5,000+",
      "fundingTotal": "$50M",
      "headcount": "85",
      "lastUpdated": "2026-05-02"
    }
  },
  "spokespeople": [
    {
      "name": "Jane Doe",
      "title": "CEO and Co-founder",
      "topics": ["strategy", "fundraising", "partnerships", "major-customers"],
      "approvalRequired": false,
      "preferredQuoteStyle": "warm-builder",
      "bioShort": "Jane is co-founder and CEO of Acme...",
      "bioLong": "[longer bio]",
      "headshotPath": "design/marketing/pr/media-kit/headshots/jane-doe.jpg"
    }
  ],
  "mediaContact": {
    "name": "Sam Smith",
    "title": "Press Officer",
    "email": "press@acme.com",
    "phone": "+1-555-0100"
  },
  "boilerplateText": "Acme is the AI productivity platform for engineering teams. Founded in 2024, the company helps engineering and product teams reduce context-switching costs and ship faster through agent-assisted development workflows. Acme is headquartered in New York with an additional office in San Francisco. For more information, visit acme.com.",
  "forwardLookingStatement": "Statements in this release that are not historical facts constitute forward-looking statements...",
  "companyType": "private",
  "industryRegulation": null,
  "currency": "USD"
}
```

When the brand's stats change (new customer count, new
fundraising, new office), update `boilerplate.json` once. All
subsequent press releases pick up the updates.

## Wire service conventions

Major paid wire services have similar but distinct conventions:

| Wire service          | Notes                                            |
| --------------------- | ------------------------------------------------ |
| **PR Newswire**       | Largest US-based wire; broad journalist network; per-release pricing |
| **Business Wire**     | Berkshire-Hathaway-owned; strong financial-press distribution |
| **GlobeNewswire**     | Mid-tier; cost-effective for routine releases    |
| **Cision**            | Distribution + journalist database; analytics layer |
| **EIN Presswire**     | Lower-cost wire; broader (sometimes lower-quality) distribution |
| **Direct outreach**   | Free but labor-intensive; relationships drive coverage |

The press-release command's metadata captures intended
distribution channels but doesn't perform submission — that
happens via the wire service's own portal or via PR-tooling
integration outside the suite's scope.

**Currency disclaimer**: wire-service prices, conventions, and
formatting requirements change. Check current wire-service
documentation before submitting; don't treat the command files
as canonical.

## SEO + AIO for press releases

Press releases sit in an interesting SEO position:

- **Wire-distributed releases** rank well externally on the wire
  service's domain (high domain authority of PRNewswire, etc.)
  for branded queries. This is the rented-distribution play.
- **Newsroom-archived releases** on the brand's own domain build
  the brand's organic authority over time. This is the owned
  play.
- **AI search engines cite press releases** as authoritative
  brand sources — when users ask AI search "what did Acme
  announce last quarter?", well-structured press releases get
  cited. AIO investment matters here.

When `.pencil-seo.json` is established, press releases follow:

- **Article schema** — datePublished, dateModified, author,
  publisher, headline
- **NewsArticle schema** — strong choice for press releases
  specifically; includes datePublished, dateline, articleSection
- **Organization schema** — referenced in the publisher field
- **Date stamping prominent** — release date appears at the top
  of the release in a visually distinct treatment
- **Quotable structure** — pull quotes get marked-up `<blockquote>`
  with `<cite>` for attribution; AI search engines extract these
  cleanly

The `market/pr/newsroom.md` command (which generates the
brand's newsroom archive page) applies stronger SEO discipline
than individual press releases — it's the SEO surface that
compounds.

## File layout

```
design/marketing/pr/
├── boilerplate.json                 spokesperson registry + boilerplate (single source of truth)
├── releases/
│   ├── <slug>.{md,json}             per-release source + metadata
│   └── ...
├── pitches/
│   ├── <release-slug>-<journalist-slug>.{md,json}
│   └── ...                          journalist-specific pitch emails
└── media-kit/
    ├── manifest.json                media-kit contents index
    ├── logos/                       brand logos in multiple formats
    ├── headshots/                   spokesperson photos
    ├── fact-sheet.{pdf,md}          brand fact sheet
    └── brand-guidelines.{pdf,md}    extracted brand guidelines for press use
```

## What's deferred — crisis comms

Crisis communication (responding to outages, security incidents,
public controversies, leadership departures) is **not** covered
by `market/pr/press-release.md` and is intentionally deferred
from this namespace.

Reasons:

- **Different urgency** — crisis releases need real-time human
  judgment; templated structure gets in the way
- **Different voice** — direct, accountable, less promotional;
  the press voice rules don't fully apply
- **Different approval workflow** — typically requires legal +
  CEO + board sign-off in compressed timeframes
- **High-variance scenarios** — security breach response differs
  enormously from outage response which differs from leadership
  scandal response; templating these well requires real
  crisis-comms expertise

Brands needing crisis comms infrastructure should engage
specialized PR counsel. The suite's promotional-PR templates
should not be adapted for crisis use; they're calibrated wrong
for the situation.

When a brand has a crisis, the right response is hand-written,
legal-reviewed, and tonally distinct from anything this
namespace produces. Acknowledging this scope limitation is more
useful than pretending templates can handle it.

## Anti-patterns

- **Brand-voice press releases** — releases written in the brand's
  warm/casual voice that ignore the news-genre conventions.
  Journalists ignore them.
- **News from a press release format that isn't news** — releases
  announcing trivia (employee birthday, internal milestone,
  generic blog post link) burn distribution credit and train
  journalists to ignore future legitimate releases.
- **Hype-language overuse** — "revolutionary", "groundbreaking",
  "industry-leading", "first-ever" without substantiation
  signals weak news. Use sparingly and substantiate when used.
- **Quotes from too many people** — releases with 4+ quotes from
  different spokespeople become quote-soup. 1-2 well-chosen
  quotes outperform.
- **Embargo abuse** — distributing under embargo to journalists
  who have no real reason to need preview time, or to
  journalists who routinely break embargo. Damages relationships.
- **No specific contact** — releases with `info@` or no real
  press contact get filed unread. A named press officer with
  direct contact is mandatory.
- **Forgotten boilerplate updates** — the boilerplate.json
  approach prevents this; without it, releases drift from current
  facts (customer count, headcount, fundraising total).
- **Over-distributing** — submitting the same release to every
  wire service simultaneously dilutes coverage and burns budget.
  Pick one primary wire service per release.
