---
description: Generate paid social ads — distinct from organic social posts. Covers Meta (Facebook + Instagram), X, LinkedIn, TikTok, Reddit, Pinterest. Per-platform aspect ratios, character limits, ad-format conventions (carousel, single-image, video, collection). Voice closer to organic but optimized for ad context. Distinct from `/market:social:*` (organic) — paid social runs through Ads Manager with audience targeting and budget.
argument-hint: <campaign-slug> [--platform meta|linkedin|x|tiktok|reddit|pinterest] [--placement feed|story|reels|in-stream|messenger|sponsored-mail] [--format single-image|carousel|video|collection|stories|sponsored-message] [--mode performance|brand] [--audience <subset>] [--landing <url-or-pen-path>] [--informed-by <brief-slug>] [--cta-style soft|direct|urgent] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate paid social ads. Distinct from `/market:social:*`
(organic posts to followers) — paid social runs through Ads
Manager interfaces with budget, audience targeting, and
optimization goals. Same platforms; different discipline.

## Why paid social differs from organic social

- **Audience is targeted, not earned** — paid ads reach people
  who don't follow the brand. The first impression is colder.
- **Performance metrics drive optimization** — CPA, ROAS, CPM,
  CTR — quantitative measurement vs organic's "engagement"
- **Creative is variant-tested** — multiple creative variations
  shipped, platform optimizes which gets shown
- **Compliance density is higher** — paid ads go through platform
  policy review; organic posts are subject to platform terms
  but not the same explicit pre-flight gating
- **Voice is slightly modulated** — organic feels native to the
  feed; paid often shows ad-like polish that gives away the
  paid context. Best paid social splits the difference: ad-
  polish where it builds trust, native-feeling where it builds
  engagement.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/ads/_context.md`, `product/.pencil-tone.json`, and
   (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json`.
3. Resolve inputs:
   - First positional: campaign slug.
   - `--platform meta|linkedin|x|tiktok|reddit|pinterest` —
     required (no default; each platform's conventions differ
     enough that defaulting risks wrong creative).
   - `--placement` — sub-format on the platform (feed, story,
     reels, etc.). Defaults vary by platform.
   - `--format single-image|carousel|video|collection|stories|sponsored-message` —
     ad format. Defaults vary by platform + placement.
   - `--mode performance|brand` — default `performance`.
   - `--audience <subset>` — channel audience, with platform-
     specific targeting layers.
   - `--landing <url-or-pen-path>`.
   - `--informed-by <brief-slug>`.
   - `--cta-style soft|direct|urgent`.

## Per-platform conventions

### Meta (Facebook + Instagram)

**Placements** (within Meta Ads Manager):
- Facebook Feed
- Facebook Stories
- Facebook Reels (newer; ad inventory growing)
- Facebook Marketplace
- Facebook In-Stream Video
- Instagram Feed
- Instagram Stories
- Instagram Reels
- Instagram Explore
- Messenger Inbox
- Messenger Stories

**Formats**:
- **Single Image** — 1:1 (1080x1080) feed, 9:16 (1080x1920)
  story/reels, 1.91:1 link-share format
- **Carousel** — 2-10 cards; each card 1:1 typically; effective
  for feature-by-feature breakdowns
- **Video** — see `/market:ads:video` for production; this
  command produces the metadata + targeting
- **Collection** — mobile-only; shoppable grid of products
  below a hero image/video
- **Stories** — 9:16 vertical full-screen; 5-15s holds
- **Reels** — 9:16 vertical; native-feeling video preferred

**Copy limits** (verify current at submission):
- Headline: ~40 chars (truncates at varying points)
- Primary text: 125 chars before "...See more"; up to 2200 total
- Description (link ads): 30 chars

**Targeting**: interests + lookalike audiences + custom audiences
(uploaded customer lists) + retargeting (Meta Pixel) + demographic
+ behaviors. **Note**: many demographic targeting options
restricted in 2022 (housing, employment, credit categories).

### LinkedIn

**Placements**:
- LinkedIn Feed
- LinkedIn Inbox (Sponsored Messaging — high-cost, high-engagement)
- LinkedIn Audience Network (off-platform extensions)

**Formats**:
- **Single Image** — 1.91:1 (1200x627) primarily
- **Carousel** — 2-10 cards
- **Video** — short-form (under 30s) performs best in feed
- **Sponsored Content** — single-image link ad
- **Sponsored Messaging** — InMail-like format; 100-character
  greeting + body
- **Document Ads** — PDF previews in feed; B2B-specific
- **Conversation Ads** — multi-step interactive InMail

**Copy limits**:
- Intro text: 600 chars; first 150 visible before truncation
- Headline: 200 chars (recent expansion)

**Targeting**: extensive professional targeting — job title,
seniority, function, industry, company size, school, skills.
B2B's strongest paid channel for this reason.

### X (formerly Twitter)

**Placements**:
- Timeline (in-feed)
- Profile Pages
- Trends placement
- Search Results

**Formats**:
- **Promoted Tweet** — same as organic tweet but boosted
- **Image Ad** — 1.91:1 or 1:1
- **Video Ad** — 16:9, 1:1, or 9:16
- **Carousel** — 2-6 slides
- **Conversation Card** — interactive prompt

**Copy limits**:
- Tweet text: 280 chars (X Premium can extend; ad copy stays
  280)

**Targeting**: interests, follower lookalikes, keywords,
events, geo. Smaller audience pool than Meta but high-engagement
when relevant.

### TikTok

**Placements**:
- For You feed (primary)
- TopView (premium first-of-day position)
- Branded Effects / Hashtag Challenges (high-budget brand plays)

**Formats**:
- **In-Feed Video** — 9:16 vertical; 5-60s; 9-15s sweet spot
- **TopView** — 60s, full-screen open of app
- **Branded Effects** — AR effect users can apply
- **Spark Ads** — boost an organic creator's post
  (high-performing format; native-feeling)

**Copy limits**:
- Caption: 100 chars typical; longer trims

**Targeting**: interests, behaviors, custom audiences, lookalike.
Less granular than Meta.

**Critical**: TikTok rewards native-feeling creative.
Corporate-polish ads underperform vs creator-style content.
Spark Ads (boosting organic creator content) is the most
TikTok-native paid format.

### Reddit

**Placements**:
- Conversation Page (within subreddit threads)
- Browse Listing (subreddit feed)

**Formats**:
- **Image Ad**, **Video Ad**, **Carousel** (2-6 cards),
  **Promoted Posts** (text + link)

**Copy limits**:
- Title: 300 chars; 100 visible
- Text body: long-form supported

**Targeting**: subreddit-context targeting is unique strength;
interest-based; geo. Subreddit-context-sensitive — some
subreddits forbid promoted posts (community moderation
overrides ad system).

**Critical**: Reddit users are sensitive to obviously-promoted
content. Native-feeling, value-first ads (informational, not
hard-sell) outperform generic creative dramatically.

### Pinterest

**Placements**:
- Pinterest Feed (Home, Search, Related Pins)

**Formats**:
- **Standard Pin** — single image, 2:3 aspect (1000x1500)
- **Video Pin** — vertical video
- **Carousel Pin** — 2-5 images
- **Shopping Pin** — product-tagged
- **Idea Pin** — multi-page video stories

**Copy limits**:
- Title: 100 chars
- Description: 500 chars; first 50 visible

**Targeting**: interests, keywords, audience lookalikes. Strong
for visual-discovery categories (home, fashion, food, DIY,
wedding).

## Phase 1 — Determine creative direction

Per platform + format, establish:

- **Hook approach** — same hook discipline as video, scaled to
  the format (carousel first card is the hook; single-image is
  hook + payoff in one)
- **Visual treatment** — platform-native vs platform-foreign.
  TikTok ads should feel TikTok-native; LinkedIn ads should
  feel professional-polished
- **Copy length** — tightly-scoped to platform limits; never
  rely on "see more" expansion to land the message
- **CTA prominence** — visible in initial frame for performance;
  end-of-content for brand

## Phase 2 — Per-platform design

For each requested platform/format combination, generate:

- **Visual asset(s)** as `.pen` design source (one frame per
  carousel card; single frame for single-image; storyboard
  reference for video)
- **Copy** — primary text, headline (where applicable),
  description, CTA label
- **Hashtags** (where platform-relevant): X, Instagram, TikTok,
  Pinterest use hashtags actively; LinkedIn moderately;
  Facebook minimal; Reddit not at all

```bash
pencil --out design/marketing/ads/social/meta/launch-saved-searches-q2-2026-feed.pen \
       --prompt "<embedded prompt: Meta feed ad, 1:1 format (1080x1080),
                 voice from .pencil-tone.json modulated +0.5 energy,
                 product screenshot lead with brand-accent overlay,
                 headline: 'Save searches in seconds',
                 CTA button overlay 'Try free'>"
```

For carousel formats, generate one `.pen` with each card as a
separate frame.

## Phase 3 — Voice + compliance check

Voice modulation per `market/ads/_context.md` performance-
social row: energy +0.5; voice closer to organic than display/
search.

Per platform compliance check:

- Meta: image-text density (used to be policy; now soft
  guideline; still affects performance)
- LinkedIn: professional-context fit; no consumer-y casual
  imagery in B2B ads
- TikTok: aggressive enforcement against perceived clickbait;
  manufactured-urgency triggers reviews
- Reddit: subreddit-policy check (some forbid promoted
  content); avoid clickbait-y headlines aggressively

## Phase 4 — Targeting metadata

Capture platform-specific targeting fields. Each platform has
its own targeting taxonomy; the metadata stores intent in
platform-neutral form, with platform-specific transform happening
at submission.

```jsonc
"social": {
  "platform": "meta",
  "placement": "instagram-feed",
  "format": "single-image",
  "asset": "design/marketing/ads/social/meta/launch-saved-searches-q2-2026-feed.pen",
  "copy": {
    "primaryText": "Save filters once, reuse forever. New saved-searches feature is live.",
    "headline": "Save searches in seconds",
    "description": "Try free for 14 days",
    "cta": "Try Free"  // platform's CTA enum value
  },
  "hashtags": ["#productivity", "#worksmarter"],
  "targeting": {
    "geo": ["US", "CA", "UK"],
    "ageRange": [25, 54],
    "interests": ["productivity-software", "team-collaboration"],
    "lookalikeFromCustomAudience": "trial-converted-12mo",
    "excludedAudiences": ["existing-customers"]
  }
}
```

## Phase 5 — Generate metadata + assets

Standard metadata JSON per `market/ads/_context.md`. Renders
deliverable assets per format:

- Single image: `.jpg` per dimensions
- Carousel: `.zip` with per-card images
- Video: pairs with `/market:ads:video` output
- Stories/Reels: `.mp4` from video pipeline (or vertical static
  `.jpg` for static ads)

## Reporting

```
✓ Paid social ad generated: launch-saved-searches-q2-2026

Platform:   Meta (Facebook + Instagram)
Placement:  Instagram Feed
Format:     Single Image (1:1, 1080x1080)
Mode:       performance
File:       design/marketing/ads/social/meta/launch-saved-searches-q2-2026-feed.{pen,jpg,json}

Copy:
  Primary text:  "Save filters once, reuse forever. New saved-searches feature is live."
  Headline:      "Save searches in seconds"
  Description:   "Try free for 14 days"
  CTA button:    "Try Free"

Targeting:
  Geo:                  US, CA, UK
  Age:                  25-54
  Interests:            productivity-software, team-collaboration
  Lookalike source:     trial-converted-12mo
  Excluded:             existing-customers

Voice: Confident Mentor (energy +0.5)

Compliance:
  Image text density:   moderate (within Meta guideline)
  No flagged claims
  No industry regulation triggered

Action items:
  1. Verify creative against Meta's current policy review queue
  2. Set up Custom Audience and Lookalike if not yet done
  3. Verify Meta Pixel firing on landing page
     (/market:ads:landing audit)
  4. Submit via Ads Manager; monitor relevance score after
     2-3 days
  5. Plan companion organic post for /market:social:meta
     (when namespace is built) — paid + organic compounds
```

## Cross-platform campaigns

A common pattern: launch a feature, run paid social on multiple
platforms simultaneously. Same campaign-slug, different
`--platform` values:

```bash
/market:ads:social launch-saved-searches-q2-2026 --platform meta --placement instagram-feed --format single-image
/market:ads:social launch-saved-searches-q2-2026 --platform meta --placement facebook-feed --format single-image
/market:ads:social launch-saved-searches-q2-2026 --platform linkedin --format single-image
/market:ads:social launch-saved-searches-q2-2026 --platform x --format single-image
```

Each produces its own platform-specific asset; the campaign-slug
threads them together for performance attribution and reporting.

## Idempotency

Re-running with same `--platform --placement --format` overwrites.
Different platform/placement/format combinations under the same
campaign-slug coexist (different filename suffixes).

## What this command does NOT do

- **Does not auto-publish to platforms.** Submission happens via
  each platform's Ads Manager; the command produces deliverables.
- **Does not handle pixel installation.** Each platform's pixel
  (Meta Pixel, LinkedIn Insight Tag, X Pixel, TikTok Pixel)
  install is engineering work; this command's metadata flags
  whether retargeting pixels are required for the campaign.
- **Does not handle Custom Audience uploads.** Custom audiences
  (uploaded customer lists for matching) are platform-side
  operations.
- **Does not produce video creative.** Use `/market:ads:video`
  for video; this command produces metadata that can reference
  a video produced separately.
- **Does not auto-generate hashtags.** Hashtag suggestion is
  noted; final hashtag decisions are creative judgment.
