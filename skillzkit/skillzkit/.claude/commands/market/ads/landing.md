---
description: Coordinate the pairing between ad creative and landing page. Message match between ad and landing is the single highest-leverage variable in ad performance — misalignment is the #1 cause of high CPA and bounce. This command orchestrates ad+landing coordination: pairs metadata, audits message match, recommends landing-page generation when missing.
argument-hint: <campaign-slug> [audit | pair | generate] [--ad-source <metadata-json-path>] [--landing-source <pen-path-or-url>] [--ad-types search,display,video,social,retargeting] [--score-threshold 0.7] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

The ad ↔ landing page coordination layer. Message match —
how closely the landing page mirrors the ad's promise — is the
highest-leverage variable in ad performance after audience
targeting. An ad promising "Save searches in seconds" sending
to a generic homepage with no mention of saved searches will
underperform an aligned ad/landing pair by 3-10x in conversion
rate.

This command orchestrates the pairing rather than producing
either side independently:

- Ad creative comes from `/market:ads:{search,display,video,social,retargeting}`
- Landing page comes from `/product:design:templates:landing-page` or
  `/product:design:design-page`
- This command coordinates them — audits message match, records
  the pairing in metadata, recommends generation when one side
  is missing

## Three modes

### Mode 1 — `pair` (record an ad ↔ landing pairing)

Use when both sides exist independently and you want to formally
pair them.

```bash
/market:ads:landing pair launch-saved-searches-q2-2026 \
  --ad-source design/marketing/ads/search/launch-saved-searches-q2-2026.json \
  --landing-source design/templates/landing-saved-searches.pen
```

Records the pairing in
`design/marketing/ads/landing/launch-saved-searches-q2-2026-pairing.json`
and updates each side's metadata with cross-references.

### Mode 2 — `audit` (check message match)

Use to verify message-match between an existing ad and landing
page (or set of ads pointing at the same landing).

```bash
/market:ads:landing audit launch-saved-searches-q2-2026
```

Walks all ads with this campaign-slug + the paired landing(s),
extracts message elements (headline, value prop, CTA, visual
treatment), scores match, and surfaces gaps.

### Mode 3 — `generate` (create matching landing for an existing ad)

Use when ad creative exists but no dedicated landing page does.

```bash
/market:ads:landing generate launch-saved-searches-q2-2026 \
  --ad-source design/marketing/ads/search/launch-saved-searches-q2-2026.json
```

Generates a landing-page brief with extracted message context
from the ad, hands off to `/product:design:templates:landing-page` for
production. The result is a new landing pen + the recorded
pairing.

## Pre-flight (all modes)

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/ads/_context.md`, and `product/.pencil-tone.json`.
2. Read `product/.pencil-brand.json`.
3. Read `product/.pencil-seo.json` if it exists. The SEO match
   dimension reads landing-page primary keyword from
   `strategy.perArchetypeTargets["landing-page"].primaryKeyword`
   (or per-page overrides when the landing has its own SEO
   metadata). When `.pencil-seo.json` doesn't exist, the SEO
   match dimension is omitted from scoring.
4. Resolve mode: positional `audit | pair | generate` (default
   `audit` when ad + landing both exist; `generate` when only ad
   exists; `pair` when explicit).
5. Resolve inputs:
   - First positional after mode: campaign slug
   - `--ad-source` — path to ad metadata JSON. When omitted,
     scan `design/marketing/ads/**/*.json` for the campaign-slug.
   - `--landing-source` — path to landing `.pen` file or URL of
     deployed landing. When omitted in audit/pair modes, look up
     from existing pairing or `--landing` field in ad metadata.
   - `--ad-types` — restrict scope to specific ad types (e.g.
     audit only search ads' message match; ignore display).
     Comma-separated; default all types in scope.
   - `--score-threshold 0.7` — minimum message-match score for
     audit to pass. Below threshold = warn; below 0.5 = fail.
   - `--dry-run` — preview without writing pairing metadata.

## Mode 1 — Pair (record pairing)

The simplest mode. Two artifacts exist; record them as a pair.

The output `pairing.json`:

```jsonc
{
  "campaignSlug": "launch-saved-searches-q2-2026",
  "pairedAt": "2026-05-02T18:42:00Z",
  "ads": [
    "design/marketing/ads/search/launch-saved-searches-q2-2026.json",
    "design/marketing/ads/display/launch-saved-searches-q2-2026.json",
    "design/marketing/ads/social/meta/launch-saved-searches-q2-2026-feed.json"
  ],
  "landing": {
    "designFile": "design/templates/landing-saved-searches.pen",
    "url": "https://acme.com/features/saved-searches",
    "messageMatchScore": null   // populated by audit mode
  },
  "messageContract": {           // captured at pairing time as the canonical promise
    "primaryHeadline": "Stop re-typing the same searches",
    "primaryBenefit": "Save filters once, reuse forever",
    "primaryCTA": "Try saved searches",
    "primaryFeature": "saved-searches",
    "audience": "trial-stalled + new-prospects (mixed)",
    "voice": "Confident Mentor (warmth +0.5)"
  }
}
```

Each ad's metadata gains a `landing.pairing` field referencing
the pairing.json. The landing's design `.pen` file gains a
metadata note referencing the pairing.

This is the lightweight mode — no scoring, just record-keeping.

## Mode 2 — Audit (score message match)

The substantive mode. Walks all ads + the landing, scores
message match across multiple dimensions, surfaces gaps.

### Phase 1 — Extract message elements

For each ad in scope, extract:

- **Primary headline** (search ad H1; display headline; video
  hook caption; social headline; retargeting headline)
- **Primary value prop** (the benefit/feature claim)
- **Primary CTA** (button or in-content link)
- **Visual treatment** (image type, color treatment, brand
  presence) — categorical: feature-screenshot,
  abstract-illustration, photo, typographic
- **Voice modulation** (from ad metadata)

For the landing page (`.pen`), extract:

- **H1** (the page's primary headline)
- **Hero subhead** (the supporting line under H1)
- **Primary CTA** (above-fold button)
- **Hero visual** (image/illustration above the fold)
- **Voice tone** (inferred from copy or from
  `product/.pencil-tone.json` if marked)

### Phase 2 — Score per dimension

Each dimension scored 0.0–1.0:

| Dimension | What's being matched | Notes |
| --------- | -------------------- | ----- |
| **Headline match** | Ad headline ↔ landing H1 | 1.0 = same key phrase; 0.0 = unrelated |
| **Benefit match**  | Ad benefit claim ↔ landing hero subhead | 1.0 = same outcome; 0.0 = unrelated |
| **CTA match**      | Ad CTA ↔ landing primary CTA | 1.0 = same/equivalent CTA; 0.0 = different ask |
| **Feature match**  | Ad feature ↔ landing primary feature | 1.0 = same feature; 0.0 = different feature |
| **Visual match**   | Ad imagery type ↔ landing hero | 1.0 = same direction; partial credit for adjacency |
| **Voice match**    | Ad voice modulation ↔ landing voice | 1.0 = same voice; 0.5 = adjacent modulation; 0.0 = different voice character |
| **SEO match**      | Ad keyword ↔ landing primary keyword | 1.0 = same keyword targeted on both; 0.5 = related; 0.0 = unrelated. Only scored for `search` ad subType (and any other ads where keyword targeting is explicit). |

Aggregate score = weighted average. Default weights:
headline 0.25, benefit 0.20, CTA 0.20, feature 0.15, visual 0.05,
voice 0.10, SEO 0.05.

The SEO match dimension is only scored when:

1. The ad's metadata declares keywords (search ads always do;
   some social ads and retargeting ads have keyword-aligned
   intent declared)
2. The landing page is designed via this suite (a `.pen` exists
   in `design/templates/`) AND `product/.pencil-seo.json` exists
   to declare the landing's primary keyword

When either side lacks the data, SEO match is omitted from
scoring (not zero — omitted, with the dimension's weight
redistributed across remaining dimensions).

The SEO match is the connective tissue between the paid-ad
funnel and organic discoverability:

- **Same keyword**, ad targets `[save searches]` and landing
  optimizes for `save searches` — the landing earns organic
  traffic for the same query the ad pays for, multiplying
  the campaign's value
- **Related keyword**, ad targets `[save searches]` and landing
  optimizes for `productivity software` — the landing serves
  ad traffic acceptably but doesn't amplify; consider whether
  a feature-specific landing is warranted
- **Unrelated**, ad targets `[save searches]` and landing
  optimizes for `team collaboration` — keyword/landing
  mismatch; ad spend is buying clicks for a query the landing
  doesn't serve well, AND the landing isn't building organic
  authority on the ad's keyword

### Phase 3 — Surface gaps

Below-threshold dimensions get specific findings:

```
[Audit] launch-saved-searches-q2-2026 — Message match: 0.64 (threshold: 0.70) ⚠ WARN

Per-ad scores:

  Search (Google):                0.78  ✓
                                  SEO match: 0.95  ✓ (ad keyword "save searches"
                                                       matches landing primary
                                                       keyword exactly)
  Display (300x250 medium rect):  0.71  ✓
                                  (display ads not SEO-scored — no keywords)
  Display (728x90 leaderboard):   0.45  ⚠ FAIL — drilldown:

    Ad H1:        "Save searches in seconds"
    Landing H1:   "Build your team's productivity hub"

    These don't share key phrasing or concept. The ad
    promises one specific feature; the landing promises a
    broader product positioning. Users clicking this ad
    expect to land on a saved-searches page; landing on a
    product-positioning page produces high bounce.

    Recommendation: either (a) update landing to lead with
    saved-searches feature, or (b) update display 728x90 ad
    headline to match landing positioning.

  Social (Meta Instagram feed):   0.83  ✓
  Retargeting (Meta mid-stage):   0.55  ⚠ WARN

    The retargeting ad references "your saved searches" as
    if the user has already engaged with the feature, but
    the landing page treats the feature as new-discovery.
    Mismatch in user-state assumption.

    Recommendation: dedicated landing variant for retargeting
    audience that acknowledges prior engagement, OR refactor
    retargeting copy to be discoverable-from-cold.

  Search (Bing):                  0.40  ⚠ FAIL
                                  SEO match: 0.10  ⚠ FAIL

    Ad keywords:        "saved search software", "filter saving"
    Landing primary KW: "team productivity hub"

    Bing search campaign targets feature-specific keywords;
    landing optimizes for product-positioning keyword.
    Outcome: ad earns clicks for queries the landing doesn't
    serve, AND the landing builds zero organic authority on
    the ad's keywords. Highest-leverage single fix in this
    campaign.

    Recommendation: dedicated saved-searches landing page
    (run /product:design:templates:landing-page saved-searches with
    primary keyword = "save searches" set in .pencil-seo.json
    perArchetypeTargets), OR drop the Bing search campaign
    (current spend produces no compounding value).
```

### Phase 4 — Record audit results

The audit writes its findings to the pairing.json's
`messageMatchScore` field plus per-ad `messageMatchAudit`:

```jsonc
{
  // ... existing pairing.json fields
  "messageMatchAudit": {
    "auditedAt": "2026-05-02T18:42:00Z",
    "overallScore": 0.64,
    "threshold": 0.7,
    "status": "warn",           // ok | warn | fail
    "perAdScores": [
      { "ad": "search-google", "score": 0.78, "status": "ok",
        "seoMatch": { "score": 0.95, "adKeyword": "save searches", "landingKeyword": "save searches" } },
      { "ad": "search-bing", "score": 0.40, "status": "fail",
        "seoMatch": { "score": 0.10, "adKeyword": "saved search software", "landingKeyword": "team productivity hub" },
        "gap": "seo-keyword-mismatch", "recommendation": "..." },
      { "ad": "display-300x250", "score": 0.71, "status": "ok" },
      { "ad": "display-728x90", "score": 0.45, "status": "fail",
        "gap": "headline-mismatch", "recommendation": "..." },
      { "ad": "social-meta-feed", "score": 0.83, "status": "ok" },
      { "ad": "retargeting-mid", "score": 0.55, "status": "warn",
        "gap": "user-state-mismatch", "recommendation": "..." }
    ]
  }
}
```

The SEO match findings flow into audit Plane 9c (content SEO
drift) when run via `/audit` — keyword-mismatch between
ad campaigns and their landing pages surfaces as a content-cluster
integrity issue.

Audit findings are surfaced to audit Plane 7e (or extension of
Plane 7c) when `/audit` runs across the project. The
team can ignore findings per-campaign or block submission with
`--strict-message-match`.

## Mode 3 — Generate (create landing for existing ad)

When ad creative exists but no dedicated landing does:

### Phase 1 — Extract message context from ad

Read the ad metadata + visual to derive:

- The promise the ad makes (headline + benefit)
- The audience the ad targets
- The CTA and post-click expectation
- The voice modulation

This becomes the brief for landing-page generation.

### Phase 2 — Hand off to landing-page generation

Invoke `/product:design:templates:landing-page` with the extracted
context as the brief:

```
Generated landing brief from ad metadata:

  Page purpose:       Convert ad clickthroughs from launch-saved-searches campaign
  Target audience:    Trial-stalled + new prospects with productivity intent
  Primary headline:   "Stop re-typing the same searches" (matching ad)
  Primary benefit:    "Save filters once, reuse forever"
  Primary CTA:        "Try saved searches" (matching ad CTA)
  Voice:              Confident Mentor (warmth +0.5)
  Featured feature:   Saved searches
  Hero visual:        Feature screenshot matching ad imagery
  Above-fold density: Performance-optimized (single CTA, scannable)
  Below-fold:         Feature deep-dive, social proof, FAQ

Hand off to /product:design:templates:landing-page launch-saved-searches?
  This will generate design/templates/landing-saved-searches.pen
  with the brief above as inputs. After generation, the pairing
  will be recorded automatically.
```

User confirms; `/product:design:templates:landing-page` runs with the
brief; pairing gets recorded; audit runs to verify match.

### Phase 3 — Verify generated landing matches

After landing-page generation, run audit mode automatically.
Score should be high (since both sides were generated from
the same context); if not, surface the unexpected mismatch
for review.

## When to NOT use a dedicated landing

Generic homepage as landing destination is sometimes correct:

- **Brand campaigns** where awareness is the goal, not conversion
- **Top-of-funnel cold audiences** where the homepage's
  positioning is more suitable than a feature-specific page
- **Very small budgets** where dedicated-landing development
  cost outweighs conversion-rate lift
- **Multi-feature ads** where the right landing is genuinely
  multi-feature

The audit's warning isn't always a fix-mandate; sometimes the
right answer is "we know the landing is generic and we've
chosen that trade-off." Document the choice in the pairing.json
notes field.

## Reporting

```
✓ Audit complete: launch-saved-searches-q2-2026

Pairing:        design/marketing/ads/landing/launch-saved-searches-q2-2026-pairing.json
Overall score:  0.62 (threshold: 0.70) ⚠ WARN

Per-ad results:
  Search (Google):                0.78 ✓
  Display 300x250:                0.71 ✓
  Display 728x90:                 0.45 ⚠ FAIL
  Social Meta feed:               0.83 ✓
  Retargeting mid:                0.55 ⚠ WARN

Top gaps:
  1. Display 728x90 headline doesn't reflect saved-searches feature
     — recommend creative update or landing variant
  2. Retargeting copy assumes prior engagement; landing assumes new
     discovery — recommend retargeting-specific landing variant

Action items:
  1. Decide per-gap: update creative, or update landing, or
     accept the trade-off (document in pairing.json notes)
  2. Re-run audit after fixes:
     /market:ads:landing audit launch-saved-searches-q2-2026
  3. Consider dedicated retargeting landing if the campaign
     ROI warrants the extra page
```

## Idempotency

`pair` mode: re-pairing same ad+landing updates timestamp and
audit results; non-destructive.

`audit` mode: stateless; produces report. Re-running with new
ad/landing changes produces updated report.

`generate` mode: re-generation prompts before overwriting an
existing landing. Generated landing is recorded as paired.

## What this command does NOT do

- **Does not generate ads.** Use the format-specific commands
  (`/market:ads:{search,display,video,social,retargeting}`)
- **Does not deploy landing pages.** Deployment is engineering
  work; the command produces design + metadata.
- **Does not measure post-click performance.** Landing-page
  conversion-rate optimization is analytics work; this command
  surfaces the message-match precondition.
- **Does not handle multi-language ad/landing pairs.** Per-
  language pairs are manual; the audit operates on the language
  of the supplied artifacts.
- **Does not optimize for SEO.** Paid landing pages and SEO-
  optimized pages have different optimal structures; this
  command optimizes for ad-traffic conversion, not search
  ranking.
