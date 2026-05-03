---
description: Coordinate a multi-platform organic social campaign — generate per-platform posts adapted from a single content brief. The cross-platform analog to /market:ads:landing — orchestrates rather than produces. Takes a single campaign brief, calls each platform's command with platform-specific adaptation, records the campaign in metadata for tracking and audit.
argument-hint: <campaign-slug> [generate | audit | pair] [--platforms x,instagram,linkedin,facebook,tiktok] [--brief <text-or-path>] [--launch-date <ISO>] [--cadence simultaneous|staggered] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

The cross-platform organic social coordinator. A multi-platform
campaign typically wants posts on 3-5 platforms simultaneously
or in a coordinated cadence. Each platform has its own
conventions; the underlying message is the same.

Three approaches to multi-platform coordination (per
`market/social/_context.md`):

1. **Verbatim cross-post** — same content everywhere. Worst:
   ignores conventions, reads as spammy.
2. **Platform-adapted cross-post** — same underlying content
   adapted per platform's conventions. **What this command
   produces by default.**
3. **Platform-native originals** — fully different content per
   platform. Highest quality; this command's `--bespoke` mode
   coordinates briefs across platforms but defers content
   generation to platform commands individually.

## Three modes

### Mode 1 — `generate` (create platform-adapted set)

Takes a single brief, generates per-platform posts with
appropriate adaptation.

```bash
/market:social:campaign launch-saved-searches-q2-2026 generate \
  --platforms x,instagram,linkedin,tiktok \
  --brief "Saved searches feature launch — built over 4 months, key learning was inputs vs result-saving distinction" \
  --launch-date 2026-05-02T10:00:00-04:00 \
  --cadence simultaneous
```

Output: per-platform posts in their respective folders +
campaign metadata recording the coordination.

### Mode 2 — `audit` (verify cross-platform consistency)

Walks all posts in a campaign, audits voice consistency,
message alignment, scheduling sense, and compliance across
platforms.

```bash
/market:social:campaign launch-saved-searches-q2-2026 audit
```

### Mode 3 — `pair` (record existing posts as a campaign)

When platform-specific posts already exist, record them as a
coordinated campaign for tracking.

```bash
/market:social:campaign launch-saved-searches-q2-2026 pair
# Auto-discovers posts with matching campaignSlug across platform folders
```

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/social/_context.md`, `product/.pencil-tone.json`,
   and (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json` and
   `product/.pencil-marketing.json`.
3. Resolve mode: positional `generate | audit | pair` (default
   `generate` when brief provided; `audit` when posts exist
   under campaign slug; `pair` when explicit).
4. Resolve inputs:
   - First positional: campaign slug.
   - `--platforms` — comma-separated list. Default depends on
     brand context: B2B-leaning brands → `x,linkedin` first,
     add others as fit; consumer-leaning → `instagram,tiktok`
     first; broad → all five.
   - `--brief` — campaign brief (free-text or path to brief
     file). Required for `generate`. Ignored for `audit`/`pair`.
   - `--launch-date <ISO>` — when the campaign launches.
     Per-platform scheduling adapts (each platform's peak
     time on launch day).
   - `--cadence simultaneous|staggered`:
     - `simultaneous`: all platforms post on launch-date
       (modulated for each platform's peak hour)
     - `staggered`: posts roll out over 1-3 days starting from
       launch-date — each platform's peak hour on its day
   - `--bespoke` (for `generate` mode): produces brief
     adaptations per platform without delegating to platform
     commands. The user runs platform commands individually
     using the bespoke briefs as input. Use when each platform's
     content is genuinely different.
   - `--dry-run` — preview without producing posts.

## Mode 1 — Generate (the default coordination)

### Phase 1 — Parse brief into a message contract

Read the brief (free-text or file). Extract:

- **Primary headline / news** — the single most-important
  thing to communicate
- **Key supporting points** — 2-4 sub-points that flesh out the
  story
- **Voice/angle** — confidence-level, build-in-public moment,
  customer celebration, etc.
- **CTA** — what action the campaign asks for (link visit,
  product try, comment, share)
- **Success criteria** — what counts as a successful campaign

The message contract becomes the spine — every per-platform
post adapts but doesn't depart from it.

```
Message contract for launch-saved-searches-q2-2026:

  Primary headline:    Saved searches just shipped
  Supporting points:
    1. 4-month build (process / depth signal)
    2. Inputs vs result-saving lesson learned
    3. Email alerts on new matches (specific value)
  Voice angle:         Build-in-public + lesson-learned framing
  Primary CTA:         Try the feature (link to product page or in-bio)
  Success criteria:    Engagement rate >= 3% across platforms;
                       link clicks >= 500 cumulative
```

The contract is recorded in the campaign metadata for later
audit reference (audit verifies posts haven't drifted from it).

### Phase 2 — Per-platform brief adaptation

Per platform in `--platforms`, generate the adapted brief that
will drive that platform's command:

```
X (single tweet):
  Hook: "We shipped saved searches today. Sounds simple. Took 4
        months. Here's why."
  Pivot: insight-led; the headline IS the hook
  CTA: link to product page (acknowledge link-throttle)
  Length: 280 chars

X (thread, 5 tweets):
  Tweet 1 (hook): "We shipped saved searches today. Sounds simple. Took 4 months. Here's why."
  Tweet 2-4: developing the inputs-vs-result lesson
  Tweet 5: CTA + link

Instagram (carousel, 5 cards):
  Hook (card 1): "You're re-typing the same searches."
  Reveal (card 2): "Save them once."
  Process (card 3): inputs-vs-result lesson visualized
  Proof (card 4): "Teams save 6-8 hours/week"
  CTA (card 5): "Try saved searches free — link in bio"

LinkedIn (text post, medium length):
  Hook: "We shipped saved searches today. Sounds simple. Took 4 months."
  Body: Build-in-public framing with the inputs-vs-result lesson
        as the substantive content
  Engagement prompt: "What's the most surprising thing you've learned from a feature you thought was simple?"

TikTok (15s POV-style native video):
  Hook: "POV: you've re-typed this filter combination 47 times this week"
  Reveal: discovers save button
  Payoff: workflow speedup montage
  Comment prompt: "What feature do you wish had a save button?"
```

The adaptations preserve the message contract while reshaping
to each platform's voice modulation, format, length, and
audience.

### Phase 3 — Delegate to platform commands

For each platform, invoke the platform-specific command with
the adapted brief:

```bash
/market:social:x launch-saved-searches-q2-2026 \
  --type tweet --has-image --has-link \
  --campaign launch-saved-searches-q2-2026

/market:social:instagram launch-saved-searches-q2-2026 \
  --type feed-carousel --carousel-cards 5 \
  --campaign launch-saved-searches-q2-2026

/market:social:linkedin launch-saved-searches-q2-2026 \
  --type text --length medium \
  --campaign launch-saved-searches-q2-2026

/market:social:tiktok launch-saved-searches-q2-2026 \
  --length 15s --style native \
  --campaign launch-saved-searches-q2-2026
```

The `--campaign` flag links each platform's metadata to the
campaign coordinator. After all platforms generate, the
coordinator records the unified metadata.

### Phase 4 — Schedule per-platform peaks

Per `--cadence`:

**Simultaneous**: each platform posts on launch-date at its
peak engagement hour. Same calendar day, different hours per
platform:

- X: 10:30 AM ET (B2B weekday morning)
- Instagram: 8:00 AM ET (early morning) or 7:00 PM ET (evening)
- LinkedIn: 9:00 AM ET (Tuesday-Thursday business hours;
  Tuesday-Wednesday-Thursday best)
- Facebook: 1:00 PM ET (mid-day)
- TikTok: 7:00 PM ET (evening peak)

**Staggered**: posts roll out over 1-3 days from launch-date:

- Day 1: X (immediate news) + LinkedIn (B2B audience first)
- Day 2: Instagram + Facebook (broader audience)
- Day 3: TikTok (leverage prior-day buzz; TikTok's
  late-mover-advantage when topic is now established)

### Phase 5 — Generate campaign metadata

```jsonc
{
  "kind": "social-campaign",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "createdAt": "2026-05-02T08:00:00Z",
  "messageContract": {
    "primaryHeadline": "Saved searches just shipped",
    "supportingPoints": [
      "4-month build (process / depth signal)",
      "Inputs vs result-saving lesson learned",
      "Email alerts on new matches (specific value)"
    ],
    "voiceAngle": "Build-in-public + lesson-learned framing",
    "primaryCTA": "Try the feature",
    "successCriteria": "Engagement rate >= 3% across platforms; link clicks >= 500 cumulative"
  },
  "launch": {
    "launchDate": "2026-05-02T10:00:00-04:00",
    "cadence": "simultaneous",
    "platforms": [
      {
        "platform": "x",
        "post": "design/marketing/social/x/launch-saved-searches-q2-2026.json",
        "scheduledFor": "2026-05-02T10:30:00-04:00",
        "status": "pending"
      },
      {
        "platform": "instagram",
        "post": "design/marketing/social/instagram/feed/launch-saved-searches-q2-2026.json",
        "scheduledFor": "2026-05-02T08:00:00-04:00",
        "status": "pending"
      },
      {
        "platform": "linkedin",
        "post": "design/marketing/social/linkedin/launch-saved-searches-q2-2026.json",
        "scheduledFor": "2026-05-02T09:00:00-04:00",
        "status": "pending"
      },
      {
        "platform": "tiktok",
        "post": "design/marketing/social/tiktok/launch-saved-searches-q2-2026.json",
        "scheduledFor": "2026-05-02T19:00:00-04:00",
        "status": "pending"
      }
    ]
  },
  "audit": {
    "consistencyScore": null,           // populated by audit mode
    "lastAuditedAt": null
  }
}
```

## Mode 2 — Audit (consistency check)

Walks all posts in the campaign. Scores cross-platform
consistency:

- **Message-contract adherence** — does each post communicate
  the contract's primary headline and supporting points?
- **Voice consistency** — does each post sound like the same
  brand, modulated appropriately per platform?
- **CTA consistency** — do CTAs across platforms point to
  related actions (same product page, same in-bio link)?
- **Compliance consistency** — are partnership disclosures
  uniform if applicable?
- **Schedule sanity** — do per-platform peak times look right?
  Are there gaps where the campaign goes dark on a key
  platform?

Surfaces drift findings:

```
[Audit] Campaign launch-saved-searches-q2-2026 — Cross-platform consistency: 0.82 ✓ OK

Per-platform alignment:
  X tweet:                  0.91 ✓ contract-aligned
  Instagram carousel:       0.85 ✓ contract-aligned
  LinkedIn text post:       0.79 ⚠ minor: voice modulation drifts
                            slightly toward sales-speak in middle paragraphs
  TikTok storyboard:        0.74 ⚠ minor: pivots from build-in-public
                            framing to a more general "save time" story —
                            still aligned but loses the lesson-learned angle

Schedule sanity:
  ✓ All platforms scheduled within 12-hour launch window
  ✓ Each platform at its peak hour
  ⚠ Instagram and X are 2.5 hours apart — viewers who follow
    both will see similar messaging in close succession.
    Consider 4+ hour spacing.

Action items:
  1. LinkedIn post: review middle paragraphs for voice drift
  2. TikTok storyboard: consider reincorporating
     lesson-learned hook
  3. Schedule: stagger X and Instagram by 4+ hours
```

## Mode 3 — Pair (record existing posts)

When platform-specific posts already exist with matching
campaignSlug, record the campaign-level metadata for tracking.
No content generation; pure record-keeping.

## Reporting

```
✓ Campaign generated: launch-saved-searches-q2-2026

Posts produced (4 platforms):

  X:           design/marketing/social/x/launch-saved-searches-q2-2026.json
               Tweet (262/280 chars), feature image, 1 hashtag
               Scheduled: Friday May 2, 10:30 AM ET

  Instagram:   design/marketing/social/instagram/feed/launch-saved-searches-q2-2026.json
               Feed carousel (5 cards), 8 hashtags
               Scheduled: Friday May 2, 8:00 AM ET

  LinkedIn:    design/marketing/social/linkedin/launch-saved-searches-q2-2026.json
               Text post (1147 chars), 3 hashtags, build-in-public angle
               Scheduled: Friday May 2, 9:00 AM ET

  TikTok:      design/marketing/social/tiktok/launch-saved-searches-q2-2026.json
               Native video storyboard (12s, POV style)
               Scheduled: Friday May 2, 7:00 PM ET
               Production handoff required before scheduled time

Campaign metadata: design/marketing/social/campaigns/launch-saved-searches-q2-2026.json

Schedule cadence: simultaneous (Friday May 2, varied hours per platform peak)

Action items:
  1. Review each platform's post in its native folder
  2. TikTok production handoff to creative team (storyboard + script)
  3. Verify message-contract alignment:
     /market:social:campaign launch-saved-searches-q2-2026 audit
  4. Run editorial drift check across all posts:
     /audit (Plane 8 will scan campaign posts)
  5. Schedule per-platform via team's posting tools
```

## Idempotency

`generate` mode: re-running overwrites all per-platform posts +
campaign metadata. Use distinct campaign slugs for variants.

`audit` mode: stateless; produces report.

`pair` mode: re-pairing updates timestamps; non-destructive.

## What this command does NOT do

- **Does not produce video for TikTok / Reels.** Storyboards +
  scripts; production downstream.
- **Does not auto-post to platforms.** Each platform's
  scheduling is downstream tool work.
- **Does not handle paid social campaigns.** That's
  /market:ads:* — paid coordination would be a separate
  campaign-level command.
- **Does not measure performance attribution across platforms.**
  Cross-platform attribution is analytics work; the campaign
  metadata records intent + scheduling, not outcomes.
- **Does not coordinate with email or ads campaigns.** Future
  /market:campaign command (Phase 6+) could orchestrate
  fully cross-channel (email + ads + social organic); this
  command is social-organic-only.
