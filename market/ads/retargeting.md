---
description: Generate retargeting ad creative — for users who've already engaged with the brand. Distinct from cold-audience ads. Sequential retargeting (different creative per stage of journey), frequency caps, exclusion strategy. Lower energy, higher specificity than cold-audience creative.
argument-hint: <campaign-slug> [--audience visited|cart-abandoned|trial-stalled|recent-customers|churned] [--stage early|mid|late|burn] [--platform meta|google-display|linkedin|x|programmatic] [--format single-image|carousel|video|dynamic-product] [--frequency-cap <count-per-period>] [--informed-by <brief-slug>] [--cta-style soft|direct|urgent] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate retargeting ad creative for warm audiences — users
who've already shown intent (visited the site, abandoned a
cart, started a trial, etc.). Retargeting works fundamentally
differently from cold-audience advertising: the user already
knows the brand and made a partial decision; the ad's job is to
help them complete it, not introduce the brand.

## Why retargeting is its own discipline

Cold-audience ads must:
1. Capture attention against unrelated content
2. Establish the brand
3. Frame the value proposition
4. Drive an action

Retargeting ads only need to:
1. Be relevant to where the user is in their journey
2. Drive the next action

This is why retargeting voice is **lower energy, more specific**
than cold creative — manufactured urgency that "works" on cold
audiences reads as desperate to a warm one.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/ads/_context.md`, `product/.pencil-tone.json`,
   (when established) `product/.pencil-editorial.json`,
   and `product/.pencil-marketing.json` (for audience definitions
   if present).
2. Read `product/.pencil-brand.json`.
3. Resolve inputs:
   - First positional: campaign slug.
   - `--audience` — required. Distinct retargeting audiences:
     - **`visited`**: visited site without converting
     - **`cart-abandoned`**: started checkout, didn't complete
     - **`trial-stalled`**: trial active but inactive
       (defined per product — e.g. no login in 5+ days)
     - **`recent-customers`**: bought recently; usually for
       upsell/expansion
     - **`churned`**: lapsed users; reactivation creative
   - **`--stage early|mid|late|burn`** — sequential retargeting
     stage:
     - **early** (1-3 days post-trigger): gentle reminder
     - **mid** (4-7 days): more direct
     - **late** (8-14 days): with-incentive ask
     - **burn** (14+ days): final touch before audience
       exclusion
   - `--platform meta|google-display|linkedin|x|programmatic` —
     platform with retargeting pixel.
   - `--format single-image|carousel|video|dynamic-product` —
     dynamic-product is e-commerce only; pulls actual cart-
     abandoned products.
   - `--frequency-cap <count-per-period>` — e.g. `3-per-7d`
     (3 impressions per 7-day window). Conservative defaults
     per stage.
   - `--informed-by <brief-slug>`.
   - `--cta-style soft|direct|urgent` — defaults vary by stage:
     early=soft, mid=direct, late=direct, burn=urgent (real
     scarcity warranted).
4. Verify privacy posture: in EU, retargeting requires cookie
   consent. The metadata records jurisdiction; the team
   verifies pixel-firing-only-after-consent infrastructure is
   in place.

## Retargeting strategy primer

### Sequential creative

Showing the same creative repeatedly to the same person produces
**ad fatigue** — diminishing CTR + rising CPM as the platform's
optimization algorithm penalizes low-relevance impressions. The
defense: sequential creative.

A standard 4-stage sequential retargeting:

| Stage | Window | Voice | Message angle | Frequency cap |
| ----- | ------ | ----- | ------------- | ------------- |
| **Early**  | Days 1-3 | warm, gentle | Reminder of what they were looking at | 2-3/week |
| **Mid**    | Days 4-7 | direct | Specific feature/benefit they likely cared about | 3-5/week |
| **Late**   | Days 8-14 | direct + offer | Time-bounded incentive | 3-4/week |
| **Burn**   | Days 14-21 | urgent (genuine) | Final touch ("we'll stop showing you ads") | 2-3 over the period, then exclusion |

After the burn stage, the audience gets excluded from
retargeting for a cool-down period (30-90 days typical). Showing
ads forever to non-converters wastes budget and erodes brand.

### Exclusion strategy

Critical: **exclude already-converted users from retargeting**.
Showing "Come back to your cart!" to a user who already
purchased is the worst-case retargeting failure — actively
annoying, brand-damaging, budget-wasting.

Required exclusions per audience:

| Audience          | Exclude these                                               |
| ----------------- | ----------------------------------------------------------- |
| visited           | Existing customers, recent visitors-who-converted           |
| cart-abandoned    | Anyone who completed checkout (in last 30d)                 |
| trial-stalled     | Trial users who became active, converted, or churned        |
| recent-customers  | Users in churn-prevention sequences, recent cancellations   |
| churned           | Users who reactivated, users in active opt-out              |

These exclusions are platform-side audience operations; the
metadata documents them so the team configures correctly.

### Frequency caps

Without a frequency cap, ad platforms over-serve to low-cost
high-intent users — the same person can see 50+ impressions
in a week, which destroys conversion rate and brand affinity.

Conservative defaults:
- **Early stage**: 2-3 impressions per 7d
- **Mid stage**: 3-5 per 7d
- **Late stage**: 3-4 per 7d
- **Burn stage**: 2-3 total over the burn window
- **Combined across all retargeting stages**: 8-10 impressions
  per 7d max

Higher frequency works for high-intent audiences (cart-
abandoned same-day) but should taper aggressively after that.

## Phase 1 — Calibrate stage-specific creative

Per stage, the creative differs in:

- **Visual recall** — early stage benefits from showing the
  product they viewed (literal recall); late stage shifts to
  outcome/benefit imagery
- **Copy specificity** — early can be brand-recall-only ("Acme,
  remember?"); late should be ask-specific ("Try free for 14
  days")
- **CTA prominence** — early CTA can be soft; late CTA is the
  reason to act

Example progression for `--audience trial-stalled`:

```
EARLY (--stage early):
  Visual:    Product UI screenshot — what they saw on the dashboard
  Headline:  "Picking up where you left off"
  Body:      "Your saved searches are still there. Take 2 minutes to
              see what came in while you were away."
  CTA:       "See your dashboard"
  Voice:     warm, low-pressure

MID (--stage mid):
  Visual:    Specific feature screenshot (the one they engaged with most
              during trial)
  Headline:  "Finish setting up saved searches"
  Body:      "You started one, but the alerts aren't on yet. Two-minute
              fix; we'll show you."
  CTA:       "Finish setup"
  Voice:     direct, specific

LATE (--stage late):
  Visual:    Customer story or social proof
  Headline:  "Teams like yours saw 8 hours/week back"
  Body:      "Saved searches + alerts is the workflow that earned this
              feedback. Your trial has 5 days left — extend free or upgrade."
  CTA:       "Extend trial / upgrade"
  Voice:     direct + incentive offer

BURN (--stage burn):
  Visual:    Brand-clean, minimal
  Headline:  "Last touch from our side"
  Body:      "We won't keep retargeting after this. If saved searches
              isn't right for you, no worries — we appreciate you giving
              us a try."
  CTA:       "Final reactivate" (or omit; burn-stage can be no-CTA brand close)
  Voice:     genuine, low-pressure, brand-positive close
```

The burn stage's tone is the trickiest. A burn ad that reads as
"manipulative final ask" damages brand more than no ad at all.
A burn ad that reads as "respectful close, no hard feelings"
preserves brand for future re-engagement (when the user might
have a different need 6 months later).

## Phase 2 — Generate creative per platform/format

Per platform + format, generate the design + copy. Format options
specific to retargeting:

- **Single image** — most flexible
- **Carousel** — strong for multi-feature reminder
- **Video** — strong for demonstration recall
- **Dynamic Product Ads (DPA)** — Meta and Google support;
  pulls the actual product/page the user viewed and renders
  it in the ad. Most relevant for e-commerce; requires product
  catalog integration.

```bash
pencil --out design/marketing/ads/retargeting/launch-saved-searches-q2-2026-mid.pen \
       --prompt "<embedded prompt: retargeting ad for trial-stalled mid-stage,
                 single image 1:1 (1080x1080) for Meta feed,
                 voice warm +0.5 (warmer than cold creative),
                 specific feature recall: saved-searches setup mid-flow,
                 headline: 'Finish setting up saved searches',
                 body: 'You started one, but the alerts aren\\'t on yet.',
                 CTA: 'Finish setup'>"
```

## Phase 3 — Voice + privacy compliance check

Voice modulation per `market/ads/_context.md` performance-
retargeting row: warmth +0.5 (warmer than cold creative; the
audience is warm).

Privacy compliance check:

- **EU jurisdictions targeted**: cookie-consent infrastructure
  required (verify, don't assume)
- **iOS 14+ ATT**: Meta Pixel data on iOS users requires App
  Tracking Transparency consent; many users decline. Audience
  size may be smaller than expected.
- **Safari/Firefox ITP**: third-party cookie blocking limits
  retargeting reach. Less relevant for first-party tracking.
- **GDPR right-to-erasure**: users requesting data deletion
  should be excluded from retargeting; verify exclusion list
  integration with the team's data-deletion process.

The metadata flags the privacy considerations for team review.

## Phase 4 — Generate metadata

Per `market/ads/_context.md` schema, with retargeting-
specific section:

```jsonc
{
  "kind": "ad",
  "subType": "retargeting",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "platform": "meta",
  "mode": "performance",
  "retargeting": {
    "audience": "trial-stalled",
    "stage": "mid",
    "trigger": {
      "definition": "Trial user with no login in 5+ days during active trial",
      "sourceData": "first-party analytics + meta-pixel-events"
    },
    "frequencyCap": "3-per-7d",
    "exclusions": [
      "trial-converted",
      "trial-active-engaged",
      "users-in-churn-prevention-sequence"
    ],
    "sequence": {
      "previousStage": "early",
      "nextStage": "late",
      "totalSequenceWindow": "21d"
    },
    "creative": "design/marketing/ads/retargeting/launch-saved-searches-q2-2026-mid.{pen,jpg}"
  },
  "audience": { ... },
  "creative": { ... },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "+0.5" }
  },
  "compliance": {
    "isMarketing": true,
    "regions": ["US", "CA", "UK", "DE"],
    "requiresCookieConsent": true,             // EU jurisdiction triggers
    "iosATTImpact": true,                      // Meta retargeting on iOS limited by ATT
    "requiresFTCDisclosure": false,
    "industryRegulation": null
  },
  "performance": { ... },
  "landing": { ... }
}
```

## Reporting

```
✓ Retargeting ad generated: launch-saved-searches-q2-2026 (mid stage)

Audience:    trial-stalled
Stage:       mid (days 4-7 post-stall)
Platform:    Meta
Format:      single-image (1:1, 1080x1080)
File:        design/marketing/ads/retargeting/launch-saved-searches-q2-2026-mid.{pen,jpg,json}

Sequence:
  Previous:  early (days 1-3) — gentle reminder
  Current:   mid  (days 4-7)  — feature-specific ask    ← THIS
  Next:      late (days 8-14) — incentive offer
  Burn:      days 14-21        — respectful close

Frequency cap:  3 impressions per 7-day window
Exclusions:     3 audiences excluded (converted, active-engaged, churn-prevention-sequence)

Voice:    Confident Mentor (warmth +0.5 — warmer than cold creative)

Compliance:
  Cookie consent required: yes (EU jurisdictions in audience)
  iOS ATT impact:          significant (~50%+ of iOS users decline)
  No FTC disclosure required
  No industry regulation flagged

Action items:
  1. Verify pixel firing only after cookie consent in EU
  2. Verify exclusion-audience definitions in Meta Custom Audiences
  3. Generate companion early/late/burn creative for full sequence:
     /market:ads:retargeting launch-saved-searches-q2-2026 --audience trial-stalled --stage early
     /market:ads:retargeting launch-saved-searches-q2-2026 --audience trial-stalled --stage late
     /market:ads:retargeting launch-saved-searches-q2-2026 --audience trial-stalled --stage burn
  4. Set up Meta Ads Manager retargeting campaign with frequency cap
     and audience exclusions configured
  5. Verify pairing with landing page:
     /market:ads:landing audit launch-saved-searches-q2-2026
```

## Idempotency

Re-running with the same `--audience` + `--stage` + `--platform`
+ `--format` overwrites. Different stages of the same campaign
coexist (filename suffix differs).

For a complete sequence, run 4 commands (early, mid, late, burn)
with the same campaign-slug and `--audience`.

## What this command does NOT do

- **Does not configure pixel-firing logic.** Pixel installation
  + consent gating is engineering work. The metadata flags
  what's required.
- **Does not configure audience exclusions in the platform.**
  Custom audiences and exclusion configurations happen in
  Ads Manager.
- **Does not handle Dynamic Product Ad catalog management.**
  DPA requires a product feed; that's e-commerce backend work.
  This command's metadata flags when DPA format is selected.
- **Does not coordinate with email retargeting** (sequence
  emails sent to lapsed/abandoned users). Email lifecycle
  retargeting is `/market:email:nurture`'s job; this
  command is paid-ad-specific.
- **Does not measure attribution.** Retargeting attribution
  is famously over-credited (the user was already converting
  anyway in many cases); the team's analytics layer handles
  attribution honesty.
