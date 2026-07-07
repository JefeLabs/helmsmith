---
description: Generate organic Instagram posts — feed posts (single image, carousel, video), Stories (24-hour ephemeral), Reels (short vertical video). Visual-first medium with copy in supporting role. Hashtag strategy still relevant. Each post type has distinct aspect ratios, length norms, and engagement dynamics.
argument-hint: <post-slug> [--type feed-image|feed-carousel|feed-video|story|reel] [--carousel-cards <n>] [--informed-by <brief-slug>] [--campaign <slug>] [--scheduled-for <ISO>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate organic Instagram posts. Instagram is the visual-first
platform — image quality and visual treatment do most of the
work; copy supports rather than leads. The brand voice is
expressed in the visual treatment + caption together.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/social/_context.md`, `product/.pencil-tone.json`,
   and (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json`.
3. Resolve inputs:
   - First positional: post slug.
   - `--type feed-image|feed-carousel|feed-video|story|reel` —
     post type. Each has different specs and conventions.
   - `--carousel-cards <n>` — for `feed-carousel`. 2-10 cards.
     Default 5.
   - `--informed-by <brief-slug>`.
   - `--campaign <slug>` — tie to multi-platform campaign.
   - `--scheduled-for <ISO>`.

## Post types — specs and conventions

### Feed image (single)

- **Aspect ratio**: 1:1 (1080x1080) safest; 4:5 (1080x1350)
  takes more feed real estate; 1.91:1 (1080x566) shows least
  in feed. **Default 1:1** unless intentional.
- **Caption length**: 2,200 char max; first ~125 chars visible
  before "more" expansion. Front-load the hook.
- **Engagement pattern**: lower than Reels for reach; higher
  than feed in 2-3 years ago. Still important for brand
  consistency.

### Feed carousel (multi-image)

- **Card count**: 2-10. Sweet spot 5-7.
- **Aspect ratio**: same per-card spec as feed image. Maintain
  consistent aspect across cards.
- **Card discipline**: each card is one idea. Card 1 is the hook
  (must work as a thumbnail); card N is the close (CTA, summary,
  or punchline).
- **Caption applies once** for the carousel. Per-card caption
  text lives in the image itself if needed.
- **Engagement pattern**: high — carousels reward swipe
  engagement; algorithm boost if users swipe through multiple
  cards.

### Feed video (single)

- **Aspect ratio**: 1:1 or 4:5 for in-feed; 9:16 reads as Reels
  (use Reels type instead if vertical)
- **Length**: 3-60s for in-feed video; longer pushes to Reels
- **Sound-off design**: autoplay-mute by default; captions
  burned-in essential
- **Engagement pattern**: declining as Reels takes precedence;
  most "feed video" production should use Reels instead

### Story

- **Aspect ratio**: 9:16 (1080x1920) full-screen vertical
- **Duration**: 24 hours ephemeral; saved to Highlights for
  permanent
- **Length**: 5-15s per story slide; multiple slides supported
- **Engagement pattern**: lower reach than feed but higher
  intent (followers actively tapping through); strong for
  poll/quiz/question stickers
- **Format flexibility**: full-screen image, video, or design
  template; stickers for engagement

### Reel

- **Aspect ratio**: 9:16 (1080x1920) full-screen vertical
- **Length**: 15-90s; sweet spot 7-30s
- **Engagement pattern**: highest organic reach mechanism on
  Instagram in 2026; Instagram explicitly prioritizes Reels
  over feed
- **Discovery**: Reels surface in Explore + Reels tab to
  non-followers; major reach amplifier when the Reel resonates
- **Voice**: most casual; native-feeling required; trend
  participation rewarded

## Voice modulation for Instagram

Per `market/social/_context.md` Instagram row: warmth +0.5,
energy +0.5. Plus type-specific:

- **Feed image / carousel**: warmth +0.5, energy +0.5 baseline
- **Story**: warmth +1.0, energy unchanged (intimate format)
- **Reel**: warmth +0.5, energy +1.0, complexity -0.5 (most
  casual; native-feeling)

Captions on Instagram tolerate longer than X — 100-300 chars
common; up to 2200. The hook in the first 125 chars matters
because that's what shows before "more." After the hook,
captions can develop a thought, tell a story, or deliver
context the visual can't.

## Phase 1 — Determine creative direction

Per `--type`, establish:

- **Visual concept**: feature screenshot, illustration,
  customer photo, behind-the-scenes, infographic-style. Each
  has different production cost and authenticity signal.
- **Caption angle**: announcement, story, question,
  educational, behind-the-scenes
- **Hashtag strategy**: 5-10 mixing general (high volume) with
  specific (relevant niche)
- **Save-worthy?** Posts that users save (bookmark) get
  algorithm boost. Educational/reference posts perform well
  on this metric.

## Phase 2 — Generate visual

Per type, generate the visual asset(s) as `.pen` design
sources.

### Feed image

```bash
pencil --out design/marketing/social/instagram/feed/saved-searches-launch.pen \
       --prompt "<embedded prompt: Instagram feed image, 1:1 (1080x1080),
                 voice from .pencil-tone.json warmth +0.5 energy +0.5,
                 feature screenshot of saved-searches with brand-accent overlay,
                 minimal text on image; caption carries the message,
                 brand-distinctive color treatment,
                 clean composition with focal point centered>"
```

### Feed carousel (5 cards example for feature launch)

```bash
pencil --out design/marketing/social/instagram/feed/saved-searches-launch-carousel.pen \
       --prompt "<embedded prompt: Instagram carousel, 5 cards 1:1 each,
                 voice fully expressed,
                 Card 1 (hook):     'You're re-typing the same searches.' (problem statement, large type)
                 Card 2 (reveal):   'Save them once.' (UI screenshot showing save button)
                 Card 3 (workflow): Quick before/after — without saved searches vs with
                 Card 4 (proof):    Customer quote or stat ('Teams save 8 hours/week')
                 Card 5 (CTA):      'Try saved searches free — link in bio' brand-accent button
                 Maintain visual consistency across cards>"
```

### Story

Stories are template-friendly. Generate as `.pen` with a
single 9:16 frame, optimized for full-screen vertical viewing:

```bash
pencil --out design/marketing/social/instagram/stories/saved-searches-launch.pen \
       --prompt "<embedded prompt: Instagram story, 9:16 (1080x1920),
                 full-screen vertical layout with safe zones (top 250px and bottom 250px
                 may be obscured by Stories UI),
                 hero feature screenshot center,
                 'Saved searches just shipped' headline upper-third,
                 'Swipe up to try' or 'Link in bio' bottom-third,
                 brand-accent dominant color>"
```

Story safe zones — Instagram's UI overlays the top and bottom
of the story screen with profile/CTA chrome. Keep critical
content centered.

### Reel storyboard

Reels are video; the design output is a storyboard (similar
to `/market:ads:video`):

```bash
pencil --out design/marketing/social/instagram/reels/saved-searches-launch-storyboard.pen \
       --prompt "<embedded prompt: Reel storyboard, 9:16 vertical, 15s,
                 5 frames over 15s,
                 voice modulated warmth +0.5 energy +1.0 complexity -0.5,
                 frame 1 (0-3s):  hook — hands typing the same search filters
                 frame 2 (3-6s):  reveal — save filter UI
                 frame 3 (6-10s): workflow speedup
                 frame 4 (10-13s): emotional payoff
                 frame 5 (13-15s): brand + 'Link in bio'
                 burned-in captions throughout (sound-off-friendly)>"
```

Reels production is downstream (similar to ads video).

## Phase 3 — Generate caption

Caption structure:

- **First line is the hook** (visible in feed before "more")
- **Body develops the idea** (story, context, value)
- **CTA at the end** ("link in bio", "save this for later",
  "tag someone who needs this")
- **Hashtags last** (separated from body by line breaks or
  invisible characters; don't intermix with body)

Example caption for the launch:

```
✨ Saved searches are live ✨

If you've ever re-typed the same filter combination because you
gave up trying to remember it, this one's for you.

Save filters once. Reapply them with one click. Get email alerts
when new matches arrive.

The teams who beta-tested saved 6-8 hours per week — time back
in their week instead of their search bar.

Link in bio to try it free. Tag a teammate who'd love this →

#productivity #worksmarter #savedsearches #teamtools
#productivityhacks #worktools #savetime #efficiency
```

Note the structure: emoji-bracketed hook, problem framing, the
fix, social proof, CTA, engagement-prompt, hashtags below.

For Reels and Stories, captions are tighter (Stories often use
text-as-image rather than caption; Reels use captions for both
discovery and accessibility).

## Phase 4 — Hashtags

Instagram hashtag strategy in 2026 (verify against current
guidance):

- **5-10 hashtags total** is the modern sweet spot
- Mix:
  - **2-3 high-volume general** (#productivity — 1M+ posts)
  - **2-3 mid-volume specific** (#productivityhacks — 500K
    posts)
  - **2-3 niche-specific** (#savedsearches — small but
    intent-aligned)
- **Avoid banned/shadowbanned hashtags** — some hashtags are
  algorithmically deprioritized due to abuse history
- **Place in caption or first comment** — both work; first
  comment keeps the caption cleaner

The command suggests a hashtag set; the user reviews before
posting.

## Phase 5 — Alt text + accessibility

Always set alt text. Instagram has an "Advanced Settings" >
"Accessibility" > "Write alt text" option per image. Without
manual entry, IG generates an alt text from AI vision —
often inadequate for branded content.

```
Alt text:
  "Screenshot of a productivity dashboard showing three saved
   searches: 'Q2 high-priority leads', 'New customer signups',
   and 'Pending tasks for review'. A 'Save filter' button is
   highlighted in the upper-right with a brand-blue accent color."
```

## Phase 6 — Voice + compliance check

Standard voice + editorial pass. Instagram-specific:

- Caption length: 2200 char hard limit
- Hashtag count: 5-10 sweet spot
- Alt text present
- FTC disclosure if partnership (use IG's "Paid partnership"
  label in addition to caption disclosure)

## Phase 7 — Generate metadata

```jsonc
{
  "kind": "social-post",
  "platform": "instagram",
  "postType": "feed-carousel",
  "name": "saved-searches-launch-carousel",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "instagram": {
    "type": "feed-carousel",
    "carouselCardCount": 5,
    "captionLength": 487,
    "hashtagCount": 8,
    "mentions": [],
    "altTextProvided": true,
    "savedToHighlight": null
  },
  "content": {
    "primaryText": "✨ Saved searches are live ✨\n\nIf you've...",
    "hashtags": ["#productivity", "#worksmarter", "#savedsearches", ...],
    "altText": "Screenshot of...",
    "linkUrl": "in-bio"   // Instagram doesn't support clickable links in feed
  },
  "media": {
    "primary": "design/marketing/social/instagram/feed/saved-searches-launch-carousel.pen",
    "kind": "carousel",
    "renderedAssets": [
      "design/marketing/social/instagram/feed/saved-searches-launch-carousel/card-1.jpg",
      // ... cards 2-5
    ]
  },
  "scheduling": {
    "scheduledFor": "2026-05-02T08:00:00-07:00",   // 8 AM PT — IG B2B peak
    "timezone": "America/Los_Angeles",
    "publishMode": "manual"
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "+0.5", "energy": "+0.5" }
  },
  "compliance": {
    "isPartnership": false,
    "platformLabelRequired": false
  },
  "performance": {
    "hypothesis": "Carousel with hook→reveal→workflow→proof→CTA structure for engagement.",
    "successMetric": "engagement rate >= 4%, swipe-through rate >= 30%, saves >= 50"
  }
}
```

## Reporting

```
✓ Instagram post generated: saved-searches-launch-carousel

Files:
  design/marketing/social/instagram/feed/saved-searches-launch-carousel.{pen,json}
  design/marketing/social/instagram/feed/saved-searches-launch-carousel/
    ├── card-1.jpg
    ├── card-2.jpg
    ├── card-3.jpg
    ├── card-4.jpg
    └── card-5.jpg

Type:           feed carousel (5 cards, 1:1 each)
Caption:        487 chars (well under 2200 max; first 125 visible
                in feed: "✨ Saved searches are live ✨...")
Hashtags:       8 (mix of high-volume + niche)
Alt text:       provided per card

Voice:          Confident Mentor (warmth +0.5, energy +0.5)
Scheduled:      Friday May 2, 8:00 AM PT
                (B2B audience peak; ed-tech industry timezone)

Compliance:
  No partnership disclosure required
  No industry regulation flagged

Action items:
  1. Preview each card in design/marketing/social/instagram/feed/saved-searches-launch-carousel/
  2. Verify card 1 works as a feed thumbnail (it's the only
     card seen until users swipe)
  3. Verify the carousel reads as a coherent sequence (each
     card earns the next swipe)
  4. Schedule via team's posting tool or Instagram native scheduler
  5. Plan companion Story for posting day:
     /market:social:instagram saved-searches-launch-story --type story
  6. Plan Reel for posting day or day after (different reach
     mechanic; Reels surface in Explore):
     /market:social:instagram saved-searches-launch-reel --type reel
```

## Idempotency

Re-running overwrites. For variant testing (different first
cards for the same carousel), use distinct slugs.

## What this command does NOT do

- **Does not auto-post.** Instagram's API for organic posting is
  limited; most teams use scheduling tools (Later, Planoly,
  Buffer, Sprout) or post manually.
- **Does not handle Stories Highlights organization.** Highlights
  curation is manual.
- **Does not produce Reels final video.** Reels production is
  downstream (similar to /market:ads:video).
- **Does not handle Instagram Shopping tags.** Product tagging is
  separate; requires shopping integration.
- **Does not measure performance.** Instagram Insights or third-
  party tools handle.
- **Does not generate hashtag suggestions from data.** Hashtag
  strategy is partly art; the command suggests reasonable sets
  for review.
