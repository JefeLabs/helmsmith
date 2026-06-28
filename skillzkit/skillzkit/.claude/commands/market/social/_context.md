# Social Organic — Medium Context (`market/social/`)

> Read this in addition to `product/strategy/_context.md`,
> `market/_context.md`, `product/.pencil-tone.json`, and (when
> established) `product/.pencil-editorial.json` whenever any
> `/market:social:*` command runs.
>
> Distinct from `/market:ads:social` (paid social with
> targeting + budget). Organic social is posts to the brand's
> follower base, with reach earned through algorithm + community
> rather than purchased through Ads Manager. Different success
> metrics, different voice discipline, different production
> cadence.

## Why organic social differs from paid social

| Concern              | Paid social                                    | Organic social                              |
| -------------------- | ---------------------------------------------- | ------------------------------------------- |
| Audience             | Targeted via platform targeting                | Earned via following + algorithm            |
| First impression     | Cold; brand introduction is part of the job    | Warm; followers chose the relationship      |
| Voice                | Modulated for ad context (energy +0.5 typical) | Voice fully expressed                       |
| Production cadence   | Per-campaign batched                           | Continuous; weekly or daily posting         |
| Success metrics      | CPA, ROAS, conversion rate                     | Engagement, reach, follower growth, sentiment |
| Compliance gating    | Platform policy review pre-flight              | Platform terms always; content moderation reactive |
| FTC disclosure       | "Sponsored" implicit (paid is paid)            | Required for partnerships (`#ad`, `#sponsored`) |
| Length tolerance     | Short typically                                | Platform-native; LinkedIn supports long; X is short |
| Hashtag strategy     | Less critical (targeting drives reach)         | Often important (discovery mechanism)       |

## Voice for organic — fully expressed

Organic posts are where the brand voice is most fully expressed.
The audience chose to follow; they're tolerant of personality,
humor, opinion. Voice modulation for organic is minimal:

| Dimension     | Modulation                  | Notes                                  |
| ------------- | --------------------------- | -------------------------------------- |
| Formality     | unchanged                   | Voice baseline                         |
| Warmth        | +0.5 (most platforms)       | Slightly warmer than canonical baseline|
| Authority     | unchanged                   | Voice baseline                         |
| Energy        | unchanged or +0.5           | Platform-dependent                     |
| Complexity    | unchanged                   | Voice baseline                         |

Per-platform modulations (documented in each platform's
`_context.md`):

- **X**: warmth unchanged, energy +0.5, complexity -0.5 (280-char
  forces compression)
- **Instagram**: warmth +0.5, energy +0.5
- **LinkedIn**: formality +0.5, energy unchanged
- **Facebook**: warmth +0.5, energy unchanged
- **TikTok**: warmth +0.5, energy +1.0, complexity -1.0 (most
  casual; native-feeling required)

## Engagement vs reach vs conversion

Organic social success metrics differ from paid:

- **Engagement rate** (likes + comments + shares per follower):
  the most-watched organic metric. Healthy organic posts hit
  2-5% engagement rate; low-performers under 1%.
- **Reach** (unique accounts that saw the post): platform-
  algorithm-controlled. Can be much smaller than follower count
  if the post performs poorly early.
- **Saves / sends** (Instagram, TikTok): high-signal — users save
  what they want to revisit.
- **Comments** (all platforms): the highest-leverage engagement;
  algorithms heavily reward.
- **Follower growth** (slower-moving): the long-term outcome.
- **Sentiment** (qualitative): hard to measure systematically;
  manual review of comments.
- **Click-through to product** (X, LinkedIn especially): when
  posts include links. Most platforms throttle reach for
  link-containing posts (algorithm prefers in-platform
  retention); link-in-bio + first-comment-link are common
  workarounds.

Organic conversion is rare and slow. A post that drives 3% of
followers to engage produced a real result; a post that drives
0.1% of followers to immediately purchase is unrealistic.
Organic builds awareness and affinity that compound over time.

## Posting cadence

Per-platform conventional cadence (verify against current
platform best practice):

| Platform   | Conventional cadence                | Notes                                  |
| ---------- | ----------------------------------- | -------------------------------------- |
| X          | 3-7 posts/day                       | Real-time; conversations matter        |
| Instagram  | 3-7 posts/week feed; daily Stories  | Reels weekly minimum for algo          |
| LinkedIn   | 3-5 posts/week                      | Higher-value posts; less frequent than X |
| Facebook   | 3-7 posts/week                      | Lower priority for many brands now     |
| TikTok    | 3-7 posts/week                      | Algorithm rewards consistency          |

**Quality over quantity always wins**. A brand posting once a
day with high-quality content beats one posting 5 times daily
with low-quality content. The algorithms penalize low-engagement
posts; post-frequency that drags engagement rate down hurts the
brand's overall reach.

## Cross-posting strategy

Three approaches to multi-platform posting:

1. **Verbatim cross-post** — same content, no adaptation. The
   worst approach: ignores platform conventions, reads as
   spammy. A 280-char tweet copy-pasted to LinkedIn looks
   abrupt; an Instagram caption-with-emoji on LinkedIn reads
   off-tone.

2. **Platform-adapted cross-post** — same underlying content
   adapted per platform's conventions, voice, length, and
   format. This is what `/market:social:campaign` produces.

3. **Platform-native originals** — fully different content per
   platform, optimized for that platform's audience. Highest
   quality but highest production cost.

The pragmatic stance: **adapted cross-post** for most launches
(efficient and platform-respectful); **platform-native originals**
for marquee campaigns or when one platform is the strategic
priority.

## Time-of-day conventions

Platforms have peak engagement windows that vary by audience
and timezone. Generic guidance (US-leaning):

- **X**: weekday mornings (8-10 AM ET) and lunch hour;
  professional-content peaks weekday business hours
- **Instagram**: weekday mornings + evenings (7-9 PM); weekends
  late morning
- **LinkedIn**: Tuesday-Thursday business hours (9 AM - 5 PM ET);
  drops sharply weekends
- **Facebook**: weekday mid-day; weekend mornings
- **TikTok**: evening hours (6-10 PM); peak weekend

Timezone-adjust for the audience's primary geography. The brand's
analytics (when available) provide more accurate timing than
generic conventions.

## Hashtag strategy

Hashtags differ wildly per platform:

- **X**: 1-2 hashtags max. More reads as desperate. Best when
  joining a real conversation hashtag, not stuffing for reach.
- **Instagram**: 5-10 in caption or first comment is the
  modern range. The "30 hashtag" strategy is outdated. Mix
  general (high volume) with specific (relevant).
- **LinkedIn**: 3-5 in post body. More than 5 reads as
  unsophisticated.
- **Facebook**: minimal — hashtags weren't native to FB and
  remain underutilized; 0-2 max.
- **TikTok**: 3-5 with at least one trending hashtag. Trend
  participation is the discovery mechanism.

The strategy isn't formulaic. Hashtags amplify reach when used
well, signal try-hard when overused.

## Alt text + accessibility

All image-bearing platforms support alt text:

- **X**: per-image alt text; up to 1000 chars. Set per-tweet.
- **Instagram**: per-image alt text via Advanced Settings;
  defaults to AI-generated if not set.
- **LinkedIn**: per-image alt text in post composer.
- **Facebook**: per-image alt text via Advanced Settings.
- **TikTok**: video captions serve the alt-text role; ensure
  captions are accurate.

**Always set alt text** on image content. It's accessibility
correctness for blind/low-vision users; it's also algorithm-
relevant (some platforms use alt text for content
classification).

## FTC disclosure for partnerships

When organic posts feature paid partnerships (sponsored content,
influencer-brand collaborations), FTC requires disclosure:

- **`#ad`, `#sponsored`, `#paid`** must appear visibly
- **"Sponsored by [Brand]"** as text in caption/body
- **Platform-native disclosure tools**: Instagram and TikTok
  have built-in "Paid partnership" labels — use them in
  addition to caption disclosure
- **Disclosure must be visible** without "see more" expansion
  on mobile

When the post's metadata declares a partnership relationship,
the command auto-adds the disclosure to the caption with
verification before posting.

## Compliance posture

Organic social is subject to:

- **Platform terms of service** — every platform reserves the
  right to remove content; some categories (hate speech,
  harassment, spam) are policy-violations regardless of the
  brand's intent
- **CAN-SPAM** — usually doesn't apply to organic social
  (it's about commercial email), but if the post drives to
  email subscription, CAN-SPAM applies to the email side
- **GDPR** — applies to any personal-data-collection within the
  post (e.g. asking commenters for personal info)
- **FTC** — disclosure rules above
- **Sectorial** — financial services, healthcare, cannabis
  carry the same restrictions as paid; even "informational"
  posts can violate substance-claim rules

Audit Plane 7c (compliance) extends to organic posts when
relevant fields are set in the post metadata.

## File layout

```
design/marketing/social/
├── x/
│   ├── <slug>.{pen,jpg,json}       (single tweet — image card if visual; .json metadata)
│   ├── <slug>-thread.json           (thread sequence)
│   └── ...
├── instagram/
│   ├── feed/
│   │   ├── <slug>.{pen,jpg,json}   (feed post)
│   │   └── ...
│   ├── stories/
│   │   ├── <slug>.{pen,jpg,json}
│   │   └── ...
│   └── reels/
│       ├── <slug>-storyboard.{pen,json}
│       └── ...
├── linkedin/
│   ├── <slug>.{pen,json}            (text post or carousel — pen for visual)
│   └── ...
├── facebook/
│   ├── <slug>.{pen,jpg,json}
│   └── ...
├── tiktok/
│   ├── <slug>-storyboard.{pen,json}
│   └── ...
└── campaigns/
    └── <campaign-slug>.json          (multi-platform coordinator)
```

The `.pen` is design source for visual posts. `.jpg`, `.mp4` are
rendered deliverables. `.json` carries metadata (caption, alt
text, hashtags, scheduling, FTC disclosure, voice modulation).

## Metadata JSON schema (per-post)

```jsonc
{
  "kind": "social-post",
  "platform": "x",                            // x | instagram | linkedin | facebook | tiktok
  "postType": "feed",                         // platform-specific: feed | story | reel | tweet | thread | carousel | video | article
  "name": "saved-searches-launch-tweet",
  "campaignSlug": "launch-saved-searches-q2-2026",  // optional; ties to campaign
  "audience": {
    "primary": "followers",
    "secondary": null,                        // sometimes posts target a sub-audience
    "geo": ["US", "CA", "UK"]                 // for time-of-day scheduling
  },
  "content": {
    "primaryText": "...",                     // caption / tweet body / post text
    "hashtags": ["#productivity", "#worksmarter"],
    "mentions": ["@partner-account"],         // when applicable
    "altText": "Screenshot of saved-searches dashboard with three saved filters listed",
    "linkUrl": "https://acme.com/features/saved-searches?utm_source=x&utm_medium=organic"
  },
  "media": {
    "primary": "design/marketing/social/x/saved-searches-launch.jpg",
    "kind": "image"                           // image | video | carousel | none
  },
  "scheduling": {
    "scheduledFor": "2026-05-02T14:30:00-07:00",   // platform's local timezone
    "timezone": "America/Los_Angeles",
    "publishMode": "manual"                   // manual | scheduled | auto-via-tool
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "energy": "+0.5", "complexity": "-0.5" }   // platform-specific
  },
  "compliance": {
    "isPartnership": false,                   // true triggers FTC disclosure
    "partnershipDisclosure": null,            // "#ad" | "#sponsored" | "Paid partnership" | null
    "regions": ["US", "CA", "UK"],
    "industryRegulation": null,
    "platformLabelRequired": false            // platform-native disclosure label (IG/TikTok)
  },
  "performance": {
    "hypothesis": "Feature-launch tweet for trial-stalled-and-prospects audience.",
    "successMetric": "engagement rate >= 3%, link clicks >= 100"
  }
}
```

## Currency disclaimer — platforms change

Social platform specs change frequently:
- Character limits (X expanded to 25K for premium then partially reverted)
- Hashtag conventions (Instagram's "30 max" guidance shifted)
- Algorithm weightings (engagement signals re-weighted constantly)
- Format support (Reels, Shorts, etc. introduced; older formats deprecated)

The command files capture current values for context but defer
to platform documentation as canonical. Reports include "Verify
against current platform docs" reminders.

## Anti-patterns

- **Verbatim cross-posting** — same content copy-pasted across
  platforms ignores platform conventions and reads as spammy
- **Posting without engaging** — brands that post and never
  reply to comments train the algorithm to deprioritize them
- **Buying engagement** — fake likes / comments are platform-
  policy violations and detection is increasingly accurate
- **Trend-chasing without authentic angle** — jumping on trending
  audio/format without something genuine to add reads as
  desperate
- **Over-reliance on hashtags** — hashtag stuffing on platforms
  where they don't help (Facebook) or where minimal use is
  the norm (X) hurts
- **Ignoring alt text** — accessibility correctness baseline;
  also algorithm-relevant
- **Inconsistent posting cadence** — algorithms reward
  consistency; sporadic posting (10 in one day, then nothing
  for two weeks) underperforms
- **Brand-only content** — feeds that are 100% brand-promoting
  underperform feeds that mix brand + value-first content
  (industry insights, customer stories, behind-the-scenes)
