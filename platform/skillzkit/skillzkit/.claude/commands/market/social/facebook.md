---
description: Generate organic Facebook Page posts — single-image, video, carousel, link, status-update, event. Lower priority for many B2B brands today (organic reach has declined sharply); still important for consumer brands with established Facebook audiences. Older demographic skew compared to other platforms.
argument-hint: <post-slug> [--type status|image|carousel|video|link|event] [--carousel-cards <n>] [--informed-by <brief-slug>] [--campaign <slug>] [--scheduled-for <ISO>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate organic Facebook Page posts. Facebook organic reach
has declined dramatically over the past decade — the platform
favors paid distribution. Many B2B brands have de-prioritized
Facebook organic; consumer brands with established audiences
still find it valuable, particularly for community-focused
content.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/social/_context.md`, `product/.pencil-tone.json`,
   and (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json`.
3. Resolve inputs:
   - First positional: post slug.
   - `--type status|image|carousel|video|link|event` —
     - `status`: text-only update
     - `image`: text + single image (1.91:1 or 1:1)
     - `carousel`: 2-10 image slides
     - `video`: native video upload
     - `link`: link share with auto-generated link preview card
     - `event`: Facebook Event (different content type entirely)
   - `--carousel-cards <n>` — for carousel; 2-10. Default 5.
   - `--informed-by <brief-slug>`.
   - `--campaign <slug>`.
   - `--scheduled-for <ISO>`.

## Honest reality check on Facebook organic

Before committing significant production effort to Facebook
organic, verify:

- **Audience size**: how many followers does the brand's
  Facebook Page have? Under 5,000 followers + 1-2% organic
  reach = posts reach 50-100 people. Production cost rarely
  justifies that distribution.
- **Audience demographics**: Facebook skews older (35+ heavily;
  55+ heavily). If the target audience is 18-34, Instagram /
  TikTok are likely better channels.
- **Audience activity**: posts to a stale audience (followers
  who haven't engaged in 6+ months) reach effectively no one.

When the answer to all three is unfavorable, recommend de-
prioritizing Facebook organic (post less frequently, focus
production effort elsewhere). The command file proceeds with
generation either way; the user makes the prioritization call.

## Voice modulation for Facebook

Per `market/social/_context.md` Facebook row: warmth +0.5,
energy unchanged. Facebook tolerates a wider voice range than
LinkedIn (less professional-context-strict) but has demographic
voice considerations (older audience tends toward more
formal/measured framing).

## Post types

### Status (text-only)

Increasingly rare for brands; usually replaced by image+text
posts. Status posts work for:
- Quick updates / announcements
- Conversation starters
- Community questions

Length: shorter posts perform better; 100-300 chars sweet spot.

### Image post

- **Aspect ratio**: 1.91:1 (1200x630) for landscape;
  1:1 (1200x1200) for square; both common
- **Caption**: 200-500 chars typical; longer fine but engagement
  drops past ~500
- **Image overlay text**: avoid heavy text in image (Facebook
  used to penalize but now soft-guidelines; still aesthetically
  better with minimal text)

### Carousel

- 2-10 cards
- 1.91:1 or 1:1 per card
- Caption applies once for the carousel
- Engagement pattern: lower than Instagram carousels but
  meaningful

### Video

- **Native video** (uploaded directly) outperforms YouTube
  embeds significantly — Facebook's algorithm prefers in-platform
  video
- **Length**: 30s-3min sweet spot; longer for documentary-style
  content
- **Aspect ratio**: 1:1 or 16:9; vertical (9:16) for Stories
- **Sound-off design**: captions essential

### Link

- Posts that include a link auto-generate a link preview card
  using the destination's OG image, title, description
- Facebook throttles reach for link-bearing posts (the platform
  prefers in-platform retention) — same dynamic as X
- **Counter-pattern**: post the message as text, link in first
  comment

### Event

Facebook Events are a distinct format — they create a dedicated
event page, allow RSVPs, send reminders, and integrate with
Facebook's event discovery. Useful for:

- Webinars
- Product launches with date-specific moments
- In-person events
- Live streams (Facebook Live)

Event metadata differs from posts (date/time, location, host,
description, image) and has its own posting flow.

## Phase 1 — Determine angle

Facebook content angles that work for B2B/SaaS:

- **Community-driven** — celebrating customers, milestones,
  team wins
- **Educational** — short tips, how-tos, industry context
- **Visual-led** — strong imagery with brief caption
- **Customer story** — full case study or success story
- **Brand moment** — milestones, anniversaries, team news

Less effective on Facebook organic in 2026: pure feature-launch
announcements (Facebook's audience is less product-news-focused
than LinkedIn or X).

## Phase 2 — Generate copy + visual

Per type, generate the deliverables. For an image-led launch
post:

```bash
pencil --out design/marketing/social/facebook/saved-searches-launch.pen \
       --prompt "<embedded prompt: Facebook image post, 1.91:1 (1200x630),
                 voice warmth +0.5,
                 feature screenshot with brand-accent overlay,
                 caption-supporting visual (caption carries the message)>"
```

Caption example for image post:

```
We shipped saved searches today — and the timing felt right
to share why this one took 4 months to get right.

The first version saved your filters as a JSON blob in your
browser. Worked great until users had 200+ saved searches; then
it broke. We rebuilt on a real database table — slower to ship,
but it scales.

Saved searches is live now: filter once, save, get email
alerts when new matches arrive.

[link to product page in first comment to avoid algorithm
throttle]

What feature in your tool stack saves you the most time?
```

The caption opens with the news, develops with a specific
detail (the 200+ failure), closes with the CTA + engagement
prompt. The link goes in first comment to avoid Facebook's
link-throttling.

## Phase 3 — Hashtags

Facebook hashtag strategy: minimal. Hashtags weren't native to
Facebook and remain underutilized. 0-2 max; some brands skip
entirely.

Best uses:
- Branded hashtags for tracking (#AcmeNews) — accumulate over
  time
- Industry-event hashtags during the event

## Phase 4 — Voice + compliance check

Standard pass. Facebook-specific:

- Caption length appropriate (don't bloat)
- Link-throttling acknowledged (link in first comment when
  applicable)
- Hashtag count ≤ 2
- FTC disclosure if partnership

Compliance:
- Facebook's specific community standards (less strict than
  LinkedIn for casual content; stricter on certain categories
  like firearms, alcohol, supplements)
- Industry regulation: financial services / healthcare on
  Facebook may need additional disclaimers given the older
  audience demographic includes vulnerable groups (retirees
  for financial; seniors for healthcare)

## Phase 5 — Generate metadata

```jsonc
{
  "kind": "social-post",
  "platform": "facebook",
  "postType": "image",
  "name": "saved-searches-launch-fb",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "facebook": {
    "postType": "image",
    "captionLength": 412,
    "hashtagCount": 0,
    "linkInBody": false,
    "linkInFirstComment": true,             // link-throttle workaround
    "originatingPage": "AcmeOfficial"
  },
  "content": {
    "primaryText": "We shipped saved searches today...",
    "hashtags": [],
    "altText": "Screenshot of saved-searches dashboard with three saved filters listed",
    "linkUrl": "https://acme.com/features/saved-searches?utm_source=facebook&utm_medium=organic"
  },
  "media": {
    "primary": "design/marketing/social/facebook/saved-searches-launch.{pen,jpg}",
    "kind": "image"
  },
  "scheduling": {
    "scheduledFor": "2026-05-02T13:00:00-04:00",  // weekday mid-day; FB peak
    "timezone": "America/New_York",
    "publishMode": "manual"
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "+0.5" }
  },
  "compliance": {
    "isPartnership": false
  },
  "performance": {
    "hypothesis": "Image post with caption-led story drives engagement from existing follower base.",
    "successMetric": "engagement rate >= 2%, post reach >= 800"
  }
}
```

## Reporting

```
✓ Facebook post generated: saved-searches-launch-fb

Files:
  design/marketing/social/facebook/saved-searches-launch.{pen,jpg,json}

Type:           image post (1.91:1, 1200x630)
Caption:        412 chars
Hashtags:       0
Link strategy:  link in first comment (avoid algo throttle)

Voice:          Confident Mentor (warmth +0.5)
Scheduled:      Friday May 2, 1:00 PM ET (FB weekday mid-day peak)

Compliance:
  No partnership disclosure required
  No industry regulation flagged

Reach reality check:
  Verify Facebook Page audience size + activity before
  committing significant production for FB organic. If reach
  is consistently under 5% of follower count, consider
  de-prioritizing in favor of paid Facebook (where targeting
  bypasses the organic-reach decline) or other organic
  channels.

Action items:
  1. Confirm whether this content earns Facebook organic
     production cost vs reallocating to higher-reach channels
  2. Preview the .jpg
  3. Schedule via team's posting tool
  4. Post link in first comment immediately after main post
     publishes
  5. Plan engagement-time-block — first 30 min after posting
     is highest-leverage for algorithm signal
```

## Idempotency

Re-running overwrites. Variants with distinct slugs.

## What this command does NOT do

- **Does not auto-post.** API or scheduling tools or manual.
- **Does not handle Facebook Groups posting.** Groups have
  different conventions (community-context); separate command
  if added.
- **Does not handle Facebook Live.** Real-time production.
- **Does not generate Facebook Ads.** That's
  /market:ads:social --platform meta.
- **Does not handle Marketplace listings.** E-commerce-specific.
- **Does not check audience size in real-time.** Reality-check
  is human judgment based on the brand's actual analytics.
