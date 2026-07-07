# Ads — Medium Context (`market/ads/`)

> Read this in addition to `product/strategy/_context.md`,
> `market/_context.md`, `product/.pencil-tone.json`, and (when
> established) `product/.pencil-editorial.json` whenever any
> `/market:ads:*` command runs.
>
> Ads are the marketing namespace's most attention-constrained
> medium. The user didn't choose to receive an ad; the ad
> competes against many others for 2-3 seconds of attention.
> The discipline here is rooted in that constraint.

## Why ads are different from other marketing

Email reaches an opted-in audience who's already shown interest.
Newsletters earn the open across many issues. Social organic
reaches followers who chose the relationship. Ads reach people
who didn't ask — and who are reading at the speed of the feed.

This produces concrete differences:

- **Compression is mandatory** — ad copy at 3-second comprehension
  beats clever copy that needs reading
- **Visual leads** — most ad formats are visual-first; copy
  supports the visual rather than the other way around
- **Compliance density is the highest** of any marketing medium —
  FTC disclosure, platform policies (which differ between
  platforms and change without notice), GDPR/ePrivacy for
  retargeting, COPPA for ads to or about minors, industry-
  specific (financial, healthcare, cannabis, alcohol)
- **Performance is measurable** — every impression, click, and
  conversion can be attributed (or *thought* to be attributed —
  attribution is partially fictional in modern privacy-aware
  ecosystems)

## Performance vs brand — the fundamental fork

Two distinct ad disciplines that share format but differ in goal:

**Performance ads** optimize for action. Click → install / sign-
up / purchase. Voice modulation tilts toward direct, lower-
warmth, energy +1.0. Success measured in CPA (cost per
acquisition), ROAS (return on ad spend), conversion rate,
attribution-window-bounded metrics.

**Brand ads** optimize for impression and recall. Goal is
"people in the target audience know this brand exists and
associate it with [thing]." Voice modulation tilts toward
warmer, more personality-forward, energy +0.5. Success measured
in reach, frequency, brand-lift studies, eventual organic
search-volume increases, hard-to-attribute long-tail revenue.

The two disciplines coexist in mature ad programs but each
campaign should know which it is. Mixing the disciplines in a
single ad usually weakens both — performance ads optimized for
brand impressions tend to underperform on conversion; brand ads
optimized for click-through can read as desperate.

`/market:ads:*` commands accept `--mode performance|brand`
where the distinction matters for voice modulation and metric
targeting. Default `performance` for `search`, `social`,
`retargeting`. Default `brand` for `video` (most TV-style
video buys are brand). `display` defaults `performance` for
specific-CTA ads, `brand` for awareness-driven creative.

## ROAS and attribution — a brief honest note

Modern ad attribution is partially fiction. iOS 14.5's ATT
prompt, Safari's Intelligent Tracking Prevention, GDPR cookie
consent in EU, the deprecation of third-party cookies — all
these have eroded the attribution chain that ad platforms
optimized for. What you see in Meta Ads Manager's "ROAS 4.2x"
report includes substantial last-touch-attribution-on-incomplete-
data error.

The pragmatic stance: attribution metrics are **directional, not
literal**. A campaign reporting 4x ROAS is plausibly
outperforming one reporting 2x; the absolute multiples are
uncertain. Cross-reference platform attribution with first-party
data (your own analytics, your conversion API events, your
business outcomes) for sanity.

The `/market:ads:*` commands generate ad creative + targeting
metadata; they don't measure attribution. That's analytics work,
and good attribution requires investment beyond what ad-creation
commands can provide.

## Voice modulation per ad type

Ads modulate voice more aggressively than any other marketing
medium because attention is the constraint:

| Mode / Format        | Warmth   | Authority  | Energy   | Complexity | Notes                                      |
| -------------------- | -------- | ---------- | -------- | ---------- | ------------------------------------------ |
| Performance — search | unchanged| unchanged  | +0.5     | -0.5       | Direct, scannable; query-relevance critical|
| Performance — display| -0.5     | unchanged  | +1.0     | -0.5       | Visual lead; copy is shorthand             |
| Performance — video  | -0.5     | unchanged  | +1.0     | -0.5       | Hook in 3 sec; sound-off-friendly          |
| Performance — social | unchanged| unchanged  | +0.5     | unchanged  | Voice closer to organic; modal differs     |
| Performance — retarget| +0.5    | unchanged  | unchanged| unchanged  | Warm audience; lower energy than cold      |
| Brand — display/video| +0.5     | unchanged  | +0.5     | unchanged  | Voice fully expressed; brand impression    |

The `--cta-style soft|direct|urgent` flag (matching email's
promotional convention) applies to performance ads; urgent
requires explicit user input because manufactured urgency in
ads erodes trust faster than in any other format (users can
detect "limited time!" as performance signaling almost
instantly).

## Platform compliance — explicit rules

Each platform maintains its own ad policies. They change without
notice. The list below is illustrative, **not a substitute for
checking the platform's current policy** at campaign-creation
time.

**Meta (Facebook + Instagram)**:
- Banned/restricted: cryptocurrency (restricted), weight loss
  (restricted with eligibility), political ads (registered
  advertisers only, with disclosures), social issues
  (registered)
- Image text: Meta no longer enforces the 20% text rule (changed
  2020) but heavy-text images still underperform — design
  discipline, not policy
- Targeting: removed many demographic targeting options in 2022
  (housing, employment, credit). Removed targeting by causes,
  organizations, public figures.

**Google Ads**:
- Banned/restricted: gambling (geo-restricted, certified
  advertisers), pharmaceuticals (certified, region-specific),
  cryptocurrencies (certified), financial services (specific
  disclosures by region), political content (verified
  advertisers, with disclosures)
- Trademark policy: competitor brand names in ad copy are
  generally not allowed; in keyword bids they often are
- Quality Score: ad-text relevance, landing-page experience,
  and click-through-rate combine into a quality score that
  affects cost-per-click and ad rank

**X Ads** (formerly Twitter Ads):
- Significant policy changes in 2023-24; check current docs
- Banned/restricted: many alcohol categories, financial advice,
  weight loss
- Political ads: re-permitted with restrictions, evolving

**LinkedIn Ads**:
- Stricter B2B-leaning policies
- Banned/restricted: most consumer categories de-prioritized;
  professional-context fit required
- Member targeting: respects opt-outs strictly

**TikTok Ads**:
- Aggressive policy enforcement against perceived clickbait
- Banned/restricted: many financial, weight-loss, health
  categories; alcohol restricted
- Creative discipline: native-feeling ads (not obviously-an-ad)
  perform better and pass policy review more easily

**Reddit Ads**:
- Subreddit-context-sensitive (some subreddits forbid promoted
  posts)
- Banned/restricted: more permissive on edgy creative than other
  platforms but stricter on misleading claims

**Programmatic display networks** (DV360, The Trade Desk,
StackAdapt, etc.):
- IAB standard policies + per-network additions
- Industry-specific verticals have their own pre-approval
  workflows (financial, pharmaceutical especially)

Commands generate creative + metadata; **they don't check
platform policy in real-time**. The metadata captures
policy-relevant fields (`disclaimer`, `regulatedCategory`,
`targetingRestrictions`) so the team can audit before submitting
to the platform.

## FTC disclosure (US)

For US-targeted ads — and increasingly required globally as
similar rules emerge:

- **`#ad`, `#sponsored`, or "Sponsored"** required when content
  appears organic but is paid (influencer posts, sponsored
  social posts, brand-funded content)
- **Disclosure must be visible** — not buried, not in
  light-gray-on-white, not off-screen on mobile
- **Material connection** must be disclosed (employee, paid,
  free product received, affiliate link)
- **Truth in advertising** — claims must be substantiable;
  comparative claims need backing data; testimonials must be
  representative

The `compliance.requiresFTCDisclosure` field in ad metadata
flags ads where this applies. Default `true` for sponsored and
influencer ads; `false` for traditional display/search where
the ad nature is contextually obvious.

## GDPR + ePrivacy for retargeting

Retargeting in EU requires consent. Cookie consent must be
obtained before retargeting pixels fire. The `pencil-marketing.json`
file should declare which jurisdictions the campaign targets;
when EU is included, retargeting requires:

- Cookie consent banner integrated with the ad platform's pixel
- Pixel firing only after consent
- Right to withdrawal (consent management platform)
- Data processing agreements with ad platforms in place

This is infrastructure work outside ad-creative commands, but
the metadata captures jurisdiction so reviewers can confirm.

## COPPA + children's advertising

Ads to or about under-13s carry stringent restrictions:

- **No behavioral targeting** of children under 13 (US COPPA);
  similar rules in many EU countries
- **No use of children's data** for ad personalization
- **Specific platform protections** — Google, Meta have
  child-direct app/site categories where ads are restricted
  to contextual

When `audienceRegulation: "k-12"` is set in brand JSON or the
ad's audience subset includes minors, ads run with extra
safeguards. The metadata flags the regulation; the team
verifies platform-side targeting respects the rules.

## Industry-specific compliance

Beyond the general rules, several industries carry their own
overlay:

- **Financial services** — SEC, FINRA (US), FCA (UK), ESMA (EU)
  rules on "guaranteed returns," past-performance claims,
  risk-disclosure requirements. "Past performance does not
  guarantee future results" is the canonical disclaimer for
  investment ads.
- **Healthcare** — FDA (US), MHRA (UK), EMA (EU) rules on drug
  advertising, off-label promotion, fair-balance requirements
  (every benefit claim accompanied by risk information). HIPAA
  for any ads using patient data.
- **Cannabis** — state-by-state US patchwork (some states allow
  ads with restrictions; others ban entirely); most major ad
  platforms restrict or ban cannabis ads regardless of local
  law; international rules vary widely.
- **Alcohol** — age-gating required on most platforms;
  "drink responsibly" disclaimers conventional;
  jurisdiction-specific restrictions on placement, content.
- **Gambling** — geo-restricted, certified-advertiser-only on
  most platforms; responsible-gambling disclaimers required.

When the brand's industry triggers any of these, the ad metadata
records it (`compliance.industryRegulation`), and audit Plane 7c
extends to verify the necessary disclaimers are present.

## File layout

```
design/marketing/ads/
├── search/
│   ├── <campaign-slug>.{json}        (responsive search ad: headlines + descriptions + keywords)
│   └── ...
├── display/
│   ├── <campaign-slug>.pen           (multi-frame canvas: each ad-unit size as a frame)
│   ├── <campaign-slug>.zip           (HTML5/static assets per ad unit)
│   └── <campaign-slug>.json          (metadata)
├── video/
│   ├── <campaign-slug>-15s.{pen,mp4,json}
│   ├── <campaign-slug>-storyboard.pen  (when production is downstream)
│   └── ...
├── social/
│   ├── meta/<campaign-slug>.{pen,jpg,json}
│   ├── linkedin/<campaign-slug>.{pen,jpg,json}
│   ├── x/<campaign-slug>.{pen,jpg,json}
│   ├── tiktok/<campaign-slug>.{pen,mp4,json}
│   └── ...
├── retargeting/
│   ├── <campaign-slug>.{pen,zip,json}  (multi-stage creative for sequential retargeting)
│   └── ...
└── landing/
    └── (landing pages live in design/templates/<slug>.pen — managed by pencil/templates;
         this folder holds the ad↔landing pairing metadata only)
        └── <campaign-slug>-pairing.json
```

The `.pen` is design source. Output assets (`.jpg`, `.mp4`,
`.zip`) are generated from `.pen` for delivery. Metadata JSON
captures targeting, compliance, voice modulation, performance
hypotheses.

## Ad metadata JSON schema

Every ad command produces metadata per this shape:

```jsonc
{
  "kind": "ad",
  "subType": "search",                     // search | display | video | social | retargeting
  "campaignSlug": "launch-saved-searches-q2-2026",
  "name": "saved-searches-search-google",
  "platform": "google",                    // google | bing | apple-search | meta | linkedin | x | tiktok | reddit | programmatic
  "mode": "performance",                   // performance | brand
  "audience": {
    "subset": "trial-users-stalled",       // matches channelAudience in .pencil-marketing.json (when applicable)
    "targeting": {                         // platform-neutral; transformed per-platform at submission
      "geo": ["US", "CA", "UK"],
      "ageRange": [25, 54],
      "interests": ["productivity-software", "team-collaboration"],
      "excludedAudiences": ["existing-customers", "active-users-30d"]
    }
  },
  "creative": {
    "primary": "design/marketing/ads/search/saved-searches-q2-2026.json",
    "variants": [
      { "name": "headline-A-feature-led",   "weight": 0.34 },
      { "name": "headline-B-benefit-led",   "weight": 0.33 },
      { "name": "headline-C-curiosity-led", "weight": 0.33 }
    ]
  },
  "cta": {
    "primary": {
      "label": "Try saved searches",
      "url": "https://acme.com/search?utm_source=google&utm_medium=cpc&utm_campaign=launch-saved-searches",
      "style": "direct"                    // soft | direct | urgent
    }
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "energy": "+0.5", "complexity": "-0.5" }
  },
  "compliance": {
    "isMarketing": true,
    "regions": ["US", "CA", "UK"],
    "requiresFTCDisclosure": false,        // true for sponsored / influencer
    "industryRegulation": null,            // financial-services | healthcare | cannabis | alcohol | gambling | null
    "requiredDisclaimers": [],
    "audienceRegulation": null             // k-12 | healthcare | financial-services | government | null
  },
  "performance": {
    "hypothesis": "Direct response from in-market trial-stalled users searching for productivity terms.",
    "successMetric": "trial-extension OR conversion",
    "targetCPA": 45,                       // dollars (currency from brand JSON if present)
    "targetROAS": 3.5,
    "attributionWindow": "7d-click-1d-view"  // platform-neutral notation
  },
  "landing": {
    "url": "https://acme.com/features/saved-searches?utm_source=google&utm_medium=cpc&utm_campaign=launch-saved-searches",
    "designFile": "design/templates/landing-saved-searches.pen",
    "messageMatchScore": null              // populated by /market:ads:landing audit
  }
}
```

Fields are platform-neutral; per-platform integrations transform
them at submission time.

## Currency disclaimer — platform specs change

Ad-platform creative specs (image dimensions, character limits,
file size, video length tiers, format support) change frequently.
The command files attempt to capture current values but **must
defer to platform documentation as canonical** at campaign-
creation time.

The pattern: command files document current values for context
and to bootstrap thinking, but every command's report includes
a "Verify against current platform docs" reminder before final
submission. When a value in the command file is known to be
outdated, a quick update PR is the right response.

## Constrained-mode notes

Ad creation is more network-dependent than most marketing
operations — platform documentation, asset upload, preview
rendering all require connectivity. In constrained environments,
commands generate the design files (`.pen`) and metadata locally;
asset rendering and platform submission are deferred until
network is available.

## Anti-patterns

- **Vague creative for "performance" goals** — performance ads
  need testable hypotheses (this headline tests benefit-framing
  vs feature-framing); generic creative produces uninterpretable
  results
- **Platform-mismatched creative** — TikTok creative ported as-is
  to LinkedIn fails. Each platform has native conventions; ads
  ignoring them get throttled by the platform's quality systems
  and ignored by users
- **Last-touch-attribution-as-truth** — modern attribution is
  partially fiction; over-investing in last-touch metrics
  produces creative that games attribution rather than driving
  business outcomes
- **Manufactured urgency** — "ACT NOW! 24 HOURS!" without genuine
  scarcity. Detected by users almost instantly. Erodes brand
  trust faster than other messaging mistakes.
- **Stock photography** — generic stock imagery in ads is the
  visual equivalent of corporate-jargon copy. Performs worse;
  reads as low-trust.
- **Unbranded ads** — ads that don't surface the brand
  prominently fail at any awareness goal. The brand should be
  visible in the first 1-2 seconds (video) or top-third
  (image).
- **Sending paid traffic to the homepage** — generic homepage
  is a weak landing for an ad with a specific message. Use
  dedicated landing pages or product-specific deep links.
- **One creative across the funnel** — cold audiences need
  awareness-building creative; warm audiences (retargeting)
  need different messaging. Same creative for both wastes one
  of the two opportunities.
