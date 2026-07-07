---
description: Generate organic X posts (single tweets and threads). 280-character compression discipline, conversational voice, real-time culture. Image cards (1.91:1 link cards or 1:1 in-feed) when visual; threads for long-form. Distinct from /market:ads:social --platform x (paid promoted tweets with targeting).
argument-hint: <post-slug> [--type tweet|thread|quote-tweet|poll] [--thread-length <n>] [--has-image] [--has-link] [--scheduled-for <ISO>] [--informed-by <brief-slug>] [--campaign <slug>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate organic X posts. The platform's hard discipline is the
character limit and the real-time culture: 280 chars, posted at
the speed of the conversation, with voice tilted toward the
punchier end of the brand's range.

X is where brands sound most like people. The voice carries the
brand's character; the platform's culture supplies the rhythm.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/social/_context.md`, `product/.pencil-tone.json`,
   and (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json`.
3. Resolve inputs:
   - First positional: post slug (e.g.
     `saved-searches-launch-tweet`).
   - `--type tweet|thread|quote-tweet|poll` — default `tweet`.
     - `tweet`: single 280-char post
     - `thread`: chain of replies for long-form (3-15 tweets
       typical)
     - `quote-tweet`: tweet quoting another with commentary
       (requires `--quote-url`)
     - `poll`: 2-4 option poll with poll text
   - `--thread-length <n>` — for threads, target tweet count.
     Default 5. Cap at 15 (longer threads lose readers).
   - `--has-image` — produce a `.pen` design source + rendered
     image card. Without this flag, text-only post.
   - `--has-link` — include a URL. X throttles link-bearing
     tweets (algorithm prefers in-platform retention); the
     command surfaces this trade-off.
   - `--scheduled-for <ISO>` — schedule for posting. Without it,
     produce metadata for manual posting.
   - `--informed-by <brief-slug>` — context.
   - `--campaign <slug>` — tie to a campaign for cross-platform
     coordination.

## Voice modulation for X

Per `market/social/_context.md` X row: warmth unchanged,
energy +0.5, complexity -0.5. Plus X-specific modulation:

- **Compression discipline**: every word earns its place.
  Filler words ("just", "really", "actually") get cut first.
  Modifiers ("very", "extremely") next.
- **Concrete over abstract**: "Save searches in seconds" beats
  "Improve your workflow with our new feature."
- **One idea per tweet**: cramming three ideas into 280 chars
  produces noise. Pick one.
- **Voice that reads aloud**: X copy that works reads naturally
  in your head. Overly-clever or formula-fitting copy doesn't.
- **Avoid corporate-speak triggers**: "thrilled to announce",
  "excited to share", "we are pleased to" — all flag as ad-
  speak even when posted organically.

## Phase 1 — Determine post type + structure

Per `--type`:

### `tweet` (single)

The most common. Structure options:

- **Announcement**: "We just shipped saved searches. Save your
  filter once, never re-type again."
- **Insight / observation**: "The most-saved feature in any tool
  is the one users built themselves: bookmarks, favorites,
  saved-searches. We just made the second one bookmark-easy."
- **Question / engagement-driver**: "Be honest — how many times
  this week did you re-type the same search? We had a number
  in mind. We were wrong."
- **Behind-the-scenes / build-in-public**: "Saved searches
  shipped today. The hardest part wasn't the feature — it was
  deciding what 'saved' should mean across 4 different views."

The structure follows from intent; the brand's voice picks the
tone. A confident-mentor voice tilts toward insight; a quieter-
specialist voice tilts toward behind-the-scenes; a warm-builder
voice tilts toward question/engagement.

### `thread`

For ideas that don't fit in 280. Thread discipline:

- **Tweet 1 is the hook**. It must work as a standalone tweet
  AND make the reader want tweet 2. Tweet 1 is also the only
  tweet most viewers see in feed; if it doesn't earn the
  click-into-thread, the thread fails.
- **Tweet count target**: 5 is a good default. Threads under 3
  could just be tweets; threads over 10 lose readers
  exponentially per tweet.
- **No filler tweets**: every tweet in a thread carries an idea.
  "And here's another thing..." filler tweets are where threads
  lose people.
- **Final tweet often the CTA or summary**: link, ask, or
  punchline lives at the end.

Thread example for a feature launch:

```
Tweet 1 (hook):
  "We shipped saved searches today. Sounds simple. Took 4 months.
   Here's why."

Tweet 2 (problem):
  "When users have 50+ filters they apply weekly, 'just save it'
   isn't simple. Different views show different fields. The same
   filter means different things in dashboard vs reports.

   We had to decide: save the inputs, or save the result?"

Tweet 3 (decision):
  "Saving the inputs (filter values) is portable across views.
   Saving the result (specific records) breaks when data changes.

   We picked inputs. Now your saved-search reapplies on every
   view automatically."

Tweet 4 (the part we got wrong):
  "First version stored filters as JSON in localStorage. Looked
   clean. Failed when users had 200+ saved searches —
   localStorage caps at 5MB.

   Moved to a real database table. Slower to build, faster to
   work."

Tweet 5 (CTA / close):
  "Saved searches is live now. Two clicks to save, one click to
   reapply, email alerts when new matches arrive.

   acme.com/features/saved-searches

   Let us know what you'd save first."
```

The hook is honest about the depth. The middle does the work.
The close gives both the link and an engagement prompt.

### `quote-tweet`

Use when reacting to or extending another tweet. Quote-tweets
that just say "this 👆" or "agreed!" don't perform. Quote-tweets
that add a perspective or extend the conversation do.

```
Quoting [tweet about productivity tools]:
  "This is the tension we ran into building saved searches —
   when users want 'productivity', they don't always want
   'fewer features'. Sometimes they want the same features
   reachable in fewer clicks.

   Saved searches is fewer-clicks-same-features. acme.com/saved-searches"
```

### `poll`

2-4 options + poll prompt. Polls drive engagement (replies +
comments) but rarely drive conversion. Best used for
conversation-starting, not direct CTA.

```
Poll prompt:
  "When you save a search/filter set, what should happen by
   default?"

Options (max 4, 25 chars each):
  - Apply on every login
  - Notify on new matches
  - Stay manual-only
  - Email me weekly digest

Duration: 1 day (default; 7 days max)
```

## Phase 2 — Generate copy

Per type and length, generate the actual copy. Always include
character count in surfaced output:

```
Generated tweet [262/280]:
  "We just shipped saved searches.

   Save your filter set once, reuse forever. Email alerts when
   new matches arrive. Cuts hours per week from teams running
   the same searches over and over.

   acme.com/saved-searches"

Variants (for A/B at thread/series level — single tweets aren't
typically A/B-tested):

  A (announcement-led, current): "We just shipped..."
  B (insight-led):                "The most-saved feature in any
                                   tool is the one users built
                                   themselves..."
  C (question-led):               "How many times this week did
                                   you re-type the same search?"
```

## Phase 3 — Generate visual (when --has-image)

X image cards have specific specs:

- **In-feed single image**: 1200x675 (16:9) optimal; supports
  wide range of aspect ratios but 16:9 is the safest
- **Link card image**: 1.91:1 (1200x628) — when the tweet has a
  link with an OG image, the OG image becomes the card. The
  tweet's "image" is the OG image of the linked page.
- **Card formats** (Twitter Cards spec):
  - Summary card (small image)
  - Summary card with large image (most common; 1.91:1)
  - Player card (video)

Generate the image as a `.pen` design:

```bash
pencil --out design/marketing/social/x/saved-searches-launch.pen \
       --prompt "<embedded prompt: X feed image, 16:9 (1200x675),
                 voice from .pencil-tone.json energy +0.5,
                 feature screenshot of saved-searches with brand-accent overlay,
                 minimal text on image (X feed already has tweet text;
                 visual should support, not duplicate),
                 brand logo bottom-right small>"
```

Render the `.pen` to `.jpg` for upload.

## Phase 4 — Hashtags + mentions

X hashtag strategy: 1-2 max. More reads as desperate.

Best hashtag use:

- Joining a real conversation (not creating yours) — `#dev` is
  noise; `#WomenInTech` during a relevant industry day is
  conversation
- Brand-specific hashtags for tracking — `#AcmeBuild` (your
  build-in-public series); these aggregate over time
- Industry-event hashtags during the event — `#NextJSConf` while
  attending

Mentions:

- Tag accounts that are genuinely relevant — partners, customers
  with permission, related communities
- Don't tag for reach — tagging unrelated big accounts is
  spammy and platform-detected

## Phase 5 — Voice + compliance check

Voice + editorial pass per established rules. X-specific
checks:

- Character count under 280 (hard limit)
- No corporate-speak triggers ("thrilled to announce", etc.)
- One idea per tweet
- Hashtag count ≤ 2
- Mentions appropriate (not spam-tagging)
- Link presence flagged (algorithm throttle awareness)

Compliance:

- FTC disclosure: when `--campaign` ties to a partnership,
  `#ad` / `#sponsored` required and added automatically
- Industry regulation: financial services / healthcare claims
  flagged for review

## Phase 6 — Generate metadata

Per `market/social/_context.md` schema with X-specific:

```jsonc
{
  "kind": "social-post",
  "platform": "x",
  "postType": "tweet",                        // tweet | thread | quote-tweet | poll
  "name": "saved-searches-launch-tweet",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "x": {
    "characterCount": 262,
    "threadLength": null,                     // null for single; integer for threads
    "hasImage": true,
    "hasLink": true,
    "linkThrottleAwareness": "acknowledged",  // X throttles link-bearing posts
    "hashtags": ["#productivity"],
    "mentions": [],
    "quotedTweet": null,
    "poll": null
  },
  "content": {
    "primaryText": "We just shipped saved searches.\n\nSave your filter...",
    "altText": "Screenshot of saved-searches dashboard showing three saved filters",
    "linkUrl": "https://acme.com/features/saved-searches?utm_source=x&utm_medium=organic"
  },
  "media": {
    "primary": "design/marketing/social/x/saved-searches-launch.jpg",
    "kind": "image"
  },
  "scheduling": {
    "scheduledFor": "2026-05-02T10:30:00-07:00",
    "timezone": "America/Los_Angeles",
    "publishMode": "manual"
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "energy": "+0.5", "complexity": "-0.5" }
  },
  "compliance": { ... },
  "performance": {
    "hypothesis": "Launch announcement to followers + hashtag-discoverable productivity audience.",
    "successMetric": "engagement rate >= 3%, link clicks >= 200"
  }
}
```

For threads, the metadata includes a `thread` array with each
tweet's content + character count.

## Reporting

```
✓ X post generated: saved-searches-launch-tweet

File:    design/marketing/social/x/saved-searches-launch-tweet.json
Image:   design/marketing/social/x/saved-searches-launch.{pen,jpg}

Type:           single tweet
Characters:     262 / 280
Has image:      yes (1200x675)
Has link:       yes (acknowledge X algorithm throttles link-bearing)
Hashtags:       1 (#productivity)

Voice:          Confident Mentor (energy +0.5, complexity -0.5)
Scheduled:      Friday May 2, 10:30 AM PT
                (peak X engagement window for B2B audience)

Compliance:
  No partnership disclosure required
  No industry regulation flagged

Action items:
  1. Preview design/marketing/social/x/saved-searches-launch.jpg
  2. Verify the tweet reads aloud naturally (the X voice test)
  3. Schedule via team's posting tool (Buffer, Sprout Social,
     native X scheduling) or post manually
  4. Plan reply-strategy: respond to first 5-10 replies within
     30 min of posting (algorithm rewards real-time engagement)
  5. Consider companion thread for build-in-public depth:
     /market:social:x saved-searches-thread --type thread --thread-length 5
```

## Idempotency

Re-running with the same post-slug overwrites. For variants
(testing different hooks for the same campaign), use distinct
slugs (`saved-searches-launch-tweet-v2-question-led`).

## What this command does NOT do

- **Does not auto-post.** Submission via X's UI / API or via
  scheduling tools (Buffer, Sprout, Hootsuite). The command
  produces deliverables.
- **Does not reply to comments.** Real-time engagement with
  replies after posting is human work.
- **Does not measure performance.** Native X analytics or
  third-party tools handle attribution.
- **Does not handle X Premium / longer-tweet features.** Default
  is 280 chars; teams using premium can hand-extend during
  posting if needed.
- **Does not generate Twitter Spaces audio content.** Spaces
  is live-audio; production is real-time human work.
