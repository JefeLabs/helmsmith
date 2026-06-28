---
description: Generate search ads for Google Ads, Bing Ads, or Apple Search Ads. Produces responsive search ads (15 headlines + 4 descriptions + extensions) with character-limit-bound headlines and benefit/feature variant strategy. Search ads are the most directly query-relevance-bound format — keyword research drives copy more than voice expression does.
argument-hint: <campaign-slug> [--platform google|bing|apple-search] [--mode performance|brand] [--keywords <list>] [--audience <subset>] [--landing <url-or-pen-path>] [--informed-by <brief-slug>] [--cta-style soft|direct|urgent] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Generate search ads — the format that appears alongside search
results when users query relevant terms. Search ads have a
unique discipline: **query relevance dominates voice**. The user
literally typed words asking for something; an ad that doesn't
mirror their intent in its first headline gets passed over no
matter how on-brand the voice.

Voice still matters — it's how the brand sounds when relevant —
but query-keyword fit is the threshold gate.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/ads/_context.md`, `product/.pencil-tone.json`, and
   (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json` for brand context.
3. Resolve inputs:
   - First positional: campaign slug (e.g.
     `launch-saved-searches-q2-2026`). Used for filenames,
     UTM params, metadata keys.
   - `--platform google|bing|apple-search` — default `google`.
     Bing inherits Google's ad format closely; Apple Search Ads
     for App Store search has different conventions (no
     descriptions; just title + subtitle).
   - `--mode performance|brand` — default `performance` for
     search ads.
   - `--keywords <comma-separated>` — the keyword targets. If
     absent, derived from campaign slug + brand context.
   - `--audience <subset>` — channel audience (mostly for
     Google's Audience Targeting layer; search ads don't
     audience-target as primarily as social ads).
   - `--landing <url-or-pen-path>` — landing destination. If a
     `.pen` path, paired metadata is recorded for the
     `/market:ads:landing` audit.
   - `--informed-by <brief-slug>` — context.
   - `--cta-style soft|direct|urgent` — default `direct`.
4. Verify keyword inputs are sensible:
   - Branded keywords (own brand name, product names) are
     usually a separate campaign — defending the brand SERP.
     Flag if branded keywords mix with general-category keywords.
   - Competitor brand keywords are policy-restricted on Google
     for ad copy; flag.
   - Single-word generic keywords (e.g. "software") have low
     intent and high cost; flag and ask user to confirm.

## Phase 1 — Keyword research summary

Document the keyword strategy for the campaign before writing
copy. The output of this phase is recorded in metadata for
later reference (and for performance debugging).

```
Keyword strategy — launch-saved-searches-q2-2026

Target keywords (high intent):
  Match type: phrase
  - "save searches"
  - "save filters"
  - "saved search software"
  - "filter saving tool"

Match type: exact
  - [save searches]
  - [saved search]

Match type: broad (modified)
  - +save +search +tool
  - +saved +filters +software

Negative keywords (excluded):
  - "free"            (price-sensitive intent; lower fit)
  - "tutorial"        (informational intent; not buyer)
  - "google sheets"   (intent for spreadsheet feature, not us)
  - competitor brand names (don't bid these without legal review)
```

Match types control how broadly the keyword triggers the ad.
Phrase match is usually the right default for new campaigns;
broad match can over-trigger with low intent; exact match
captures only the most specific queries.

When `--keywords` isn't provided, derive a starting keyword set
from the campaign slug + brand context, but **always confirm
with the user before submission** — keyword bids are real
budget commitments.

## Phase 2 — Voice modulation for search

Voice modulation per `market/ads/_context.md` performance-
search row: energy +0.5, complexity -0.5. Plus search-specific
modulation:

- **Headlines lead with keyword** when natural — "Save
  searches in seconds" beats "Stop typing the same searches"
  for the keyword "save searches" because the keyword appears
  intact in the headline. Quality Score rewards this.
- **First headline is the highest-leverage** — it appears most
  often in served combinations. Make it the single
  most-relevant headline.
- **Avoid voice flourish that obscures keyword fit** — a clever
  rhetorical headline ("Stop the search-typing madness")
  performs worse than a direct one ("Save searches in seconds")
  for a query "save searches", regardless of how on-brand the
  clever version reads.

The `--cta-style` flag controls CTA-aspect:
- `soft`: "Learn more" / "See how it works"
- `direct`: "Try saved searches" / "Get started"
- `urgent`: "Try free for 14 days" (uses real time-bound
  attribute; never manufactured)

## Phase 3 — Generate Responsive Search Ad assets

Google's Responsive Search Ad (RSA) format requires:

- **3-15 headlines**, 30 characters each maximum
- **2-4 descriptions**, 90 characters each maximum
- **Path 1 + Path 2** (display URL paths), 15 characters each
- **Final URL** (where clicks land)

Bing's format mirrors Google's. Apple Search Ads is simpler
(title + optional subtitle), handled below.

Generate at least:

- **5 distinct headlines** spanning angles:
  - Feature-led (the thing itself): "Save searches in seconds"
  - Benefit-led (the outcome): "Stop re-typing the same searches"
  - Brand-led: "Acme — save what you find"
  - Authority-led (when brand-fit): "Built by people who hate re-typing"
  - Specific-feature-led (when applicable): "Saved searches with email alerts"
- **3 descriptions** spanning angles:
  - Feature-list: "Save filters, tags, and search queries. Email alerts when new matches arrive."
  - Outcome-led: "Cut hours per week from your workflow. 10x faster than re-running the same search."
  - Brand-led: "From the team behind Acme. Built for people who run dozens of saved searches per week."
- **Path 1, Path 2** (URL paths shown in the ad):
  - Path 1 example: `features` (15 chars max)
  - Path 2 example: `saved-searches` (15 chars max)
- **Final URL**: from `--landing` argument or derived

Each headline character count is **strictly enforced** at 30
chars; descriptions at 90. Going over breaks ad submission.
Document the count next to each headline:

```
HEADLINES (30 char max):
  H1 [29]: Save searches in seconds
  H2 [27]: Stop re-typing searches
  H3 [27]: Acme — save what you find
  H4 [29]: Saved searches with alerts
  H5 [25]: Filter once, search ever

DESCRIPTIONS (90 char max):
  D1 [82]: Save filters, tags, and search queries. Email alerts when new matches arrive.
  D2 [89]: Cut hours per week from your workflow. 10x faster than re-running the same search.
  D3 [73]: From the team behind Acme. Built for people who use saved searches.
```

## Phase 4 — Apple Search Ads (when --platform apple-search)

Apple Search Ads for App Store has a different structure:

- **Default product page** appears as the ad (uses App Store
  metadata directly — title, subtitle, screenshots, icon)
- **Custom product pages** can be created in App Store Connect
  for specific keyword groups
- **Keyword-driven**, not creative-driven — the App Store
  product page IS the creative

For Apple Search Ads, the command's deliverable is a keyword
strategy + Custom Product Page recommendation rather than RSA
asset:

```
Apple Search Ads strategy:

Keyword groups:
  Group 1 — broad-match: "task tracker", "project management"
  Group 2 — exact-match: [acme task tracker], [acme]
  Group 3 — defensive: competitor brand names (allowed on
                        Apple unlike Google)

Recommended Custom Product Pages:
  CPP-1: Saved searches feature spotlight
         (tied to Group 1 keywords)
         App Store screenshots: feature-focused,
         saved-searches first
  CPP-2: General product page
         (tied to brand keywords)
```

The Custom Product Page screenshots themselves are designed via
`product/design/templates/landing-page` (or a new App Store listing
template if added). The ad command produces the keyword + CPP
strategy.

## Phase 5 — Sitelink + callout extensions

Beyond the core ad, Google Ads supports extensions that improve
real estate and CTR:

- **Sitelinks**: 4-6 secondary links shown below the ad. Each
  is a 25-char title + optional 35-char description.
  Recommended: include sitelinks for high-traffic sub-pages
  (Pricing, Customers, Docs, Blog).
- **Callout extensions**: short, non-clickable phrases (25
  chars each). 4-10 callouts per ad group.
- **Structured snippets**: pre-defined categories (Features,
  Services, Brands, etc.) with values per category.
- **Call extensions** (if applicable): phone number in the ad
  for mobile click-to-call.

The command generates a recommended set of extensions. Example:

```
Sitelinks (recommended 4):
  - Title: "View pricing"      | Desc: "Plans starting at $29/mo"
  - Title: "How it works"      | Desc: "2-minute product tour"
  - Title: "Customer stories"  | Desc: "How teams save 8 hrs/week"
  - Title: "Sign up free"      | Desc: "Free trial, no credit card"

Callouts (recommended 6):
  - "14-day free trial"
  - "No credit card needed"
  - "Used by 5,000+ teams"
  - "Built-in email alerts"
  - "GDPR + SOC 2 compliant"
  - "Free migration support"

Structured snippet — Features:
  Header: Features
  Values: Saved searches, Email alerts, Custom dashboards,
          Team workspaces, API access
```

Each extension's character counts must verify per Google's
limits.

## Phase 6 — Voice + editorial check

Run each headline and description through the voice + editorial
filter:

- Voice: does the modulated voice fit the canonical voice?
  Mental `tone:test --strict --context other`.
- Editorial: capitalization (search ads typically use sentence-
  case; some brands use title-case for headlines but search
  ads convert better with sentence-case), avoid-list words.
- Avoid spam triggers: excessive caps, exclamation points
  (search ads should usually not have any), `!!!`, `$$$`, etc.
- Avoid policy violations: superlatives without substantiation
  ("best", "#1") may need claim-substantiation; "guaranteed"
  has compliance implications.

## Phase 7 — Generate metadata JSON

Per `market/ads/_context.md` schema, plus search-specific
fields:

```jsonc
{
  "kind": "ad",
  "subType": "search",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "name": "saved-searches-search-google",
  "platform": "google",
  "mode": "performance",
  "search": {
    "keywords": [
      { "keyword": "save searches",       "matchType": "phrase" },
      { "keyword": "saved search",        "matchType": "exact"  },
      { "keyword": "filter saving tool",  "matchType": "phrase" }
    ],
    "negativeKeywords": ["free", "tutorial", "google sheets"],
    "headlines": [
      { "text": "Save searches in seconds",      "chars": 25, "angle": "feature" },
      { "text": "Stop re-typing searches",       "chars": 23, "angle": "benefit" },
      { "text": "Acme — save what you find",     "chars": 25, "angle": "brand"   }
    ],
    "descriptions": [
      { "text": "Save filters...",  "chars": 82, "angle": "feature-list" },
      { "text": "Cut hours per...", "chars": 89, "angle": "outcome"      }
    ],
    "extensions": {
      "sitelinks": [...],
      "callouts": [...],
      "structuredSnippets": [...]
    },
    "displayUrl": {
      "path1": "features",
      "path2": "saved-searches"
    }
  },
  "audience": { ... },
  "creative": { ... },
  "cta": { ... },
  "voice": { ... },
  "compliance": {
    "isMarketing": true,
    "regions": ["US", "CA", "UK"],
    "requiresFTCDisclosure": false,
    "industryRegulation": null,
    "requiredDisclaimers": []
  },
  "performance": { ... },
  "landing": {
    "url": "...",
    "designFile": "design/templates/landing-saved-searches.pen",
    "messageMatchScore": null
  }
}
```

## Reporting

```
✓ Search ad generated: launch-saved-searches-q2-2026 (Google)

File:    design/marketing/ads/search/launch-saved-searches-q2-2026.json

Strategy:    performance, direct CTA
Keywords:    7 targets (3 phrase, 2 exact, 2 broad-modified)
             4 negative keywords
Headlines:   5 generated, all under 30 chars
Descriptions: 3 generated, all under 90 chars
Extensions:  4 sitelinks, 6 callouts, 1 structured snippet

Voice:       Confident Mentor (energy +0.5, complexity -0.5)
             Modulated for search-ad scannability

Compliance:
  Platform policy:    no flagged terms
  FTC disclosure:     not required (search ads contextually obvious)
  Industry regulation: none

Action items:
  1. Review headlines + descriptions against your team's
     voice instinct (run /market:tone:test)
  2. Verify negative keyword list against actual search-term
     report after launch
  3. Set up landing page if not yet done:
     /product:design:templates:landing-page launch-saved-searches
  4. Verify pairing metadata: /market:ads:landing audit
  5. Submit to Google Ads — verify quality score after 2-3
     days of impressions; iterate on low-quality-score ads
```

## Idempotency

Re-running with the same campaign-slug overwrites. For variant
tests, use distinct campaign-slugs (`launch-saved-searches-q2-
2026-test-A`, `...-test-B`).

## What this command does NOT do

- **Does not bid on keywords.** Bid management is platform work
  (or specialized tooling); the command produces the creative
  and keyword strategy.
- **Does not check quality score in real time.** Quality score
  is platform-side and changes as the ad serves; review
  post-launch and iterate.
- **Does not handle Google Performance Max.** Performance Max
  is a different format (multi-channel, auto-optimized);
  warrants its own command if added.
- **Does not write the landing page.** Landing pages live in
  `product/design/templates/*`; this command pairs with them via the
  `--landing` argument.
- **Does not auto-translate ads to other languages.** Per-
  language ad creative is manual or via translation pipeline.
