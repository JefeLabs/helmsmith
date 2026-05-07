---
description: Generate organic TikTok posts — short vertical video (9:16). Native-feeling content discipline; sound-on-engagement after sound-off-autoplay; trending audio + hashtag participation rewarded by algorithm. Distinct from /market:ads:social --platform tiktok (paid). Most casual voice modulation of any platform.
argument-hint: <post-slug> [--length 7s|15s|30s|60s] [--style native|polished|trend-participation] [--informed-by <brief-slug>] [--campaign <slug>] [--scheduled-for <ISO>] [--storyboard-only] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate organic TikTok posts. TikTok is the most native-
feeling-content-required platform — corporate-polished video
underperforms dramatically vs creator-style native content.
The platform rewards trend participation, audio borrowing, and
authentic personality over production polish.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/social/_context.md`, `product/.pencil-tone.json`,
   and (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json`.
3. Resolve inputs:
   - First positional: post slug.
   - `--length 7s|15s|30s|60s` — video duration. Sweet spot
     7-15s for highest completion rate; 30s+ for content with
     real depth that earns the time.
   - `--style native|polished|trend-participation`:
     - `native`: looks like creator content (handheld feel, low
       production, conversational); highest organic performance
     - `polished`: brand-produced, scripted, higher-budget;
       performs well only when genuinely creative
     - `trend-participation`: borrows trending audio, format,
       or meme; highest reach potential when authentic, worst
       failure when forced
   - `--informed-by <brief-slug>`.
   - `--campaign <slug>`.
   - `--scheduled-for <ISO>`.
   - `--storyboard-only` — produce storyboard `.pen` + script
     without expecting `.mp4` (production downstream).

## TikTok organic-content reality

TikTok rewards what feels native to the platform. Content that
performs:

- **Creator-style** — handheld, conversational, edited like a
  vlog; personality-forward
- **Trend-participation** — joining a trending audio, dance,
  meme, or format with an authentic angle
- **Educational native** — short tutorials, tips, reveals
  (B2B/SaaS works here when the topic is genuinely useful)
- **Behind-the-scenes** — process, workflow, day-in-the-life
- **Stitches and duets** — responding to or building on other
  creators' content
- **Pattern interrupts** — unexpected openings that earn the
  next 2 seconds of attention

Content that underperforms:

- **Polished brand commercials** — too obviously-an-ad; viewers
  scroll past
- **Reposted-from-elsewhere content** — Reels/Shorts content
  ported to TikTok feels wrong
- **Heavy-text overlay videos** — text-on-video is fine; if the
  video is mostly text reading, it underperforms
- **Generic stock footage** — no place on TikTok
- **Overly-long without purpose** — TikTok used to reward 60s+
  for "long form"; that's reverted; under-15s usually wins

## Voice modulation for TikTok

Per `market/social/_context.md` TikTok row: warmth +0.5,
energy +1.0, complexity -1.0. Plus TikTok-specific:

- **Conversational pacing** — sounds-like-a-person voiceover/
  caption; not corporate-speak
- **First 1-2 seconds carry the post** — even more than other
  video platforms, the hook is brutal on TikTok
- **Sound-design matters more** — viewers turn sound on after
  the first 1-2 seconds if the video earns it; sound enhances
  rather than carries (videos still need to work sound-off in
  early seconds)
- **Comments-driving content wins** — TikTok algo heavily
  weights comment volume; create reasons-to-comment

## Phase 1 — Determine concept

The concept matters more than execution on TikTok. Three
questions to answer before storyboarding:

1. **What's the hook?** What happens in the first 1-2 seconds
   that earns the next 5? Pattern interrupt, surprising
   visual, surprising claim, dramatic reveal, joining a trend.
2. **What's the payoff?** Why would viewers watch to the end
   AND comment? Educational reveal, satisfying conclusion,
   emotional moment, debate-able take, discussion-prompt.
3. **What's the platform-fit?** Does this feel like TikTok or
   like an ad ported to TikTok? When uncertain, simpler wins.

For the saved-searches feature launch:

```
Concept option A: "POV: you finally save your search"
  Native creator-style; first-person framing
  Hook: "POV: you've re-typed the same filter combination 47 times this week"
  Reveal: "And then you discovered the save button"
  Payoff: workflow speedup montage
  Comment-prompt: "Which feature do you wish your tool had a 'save' button for?"

Concept option B: "Reading user feedback that hits"
  Trend-participation; uses popular "reading messages" format
  Hook: scroll through customer feedback messages
  Build: progressively more enthusiastic feedback
  Payoff: "We added saved searches this week. Worth it."
  Comment-prompt: "What's a feature you'd lose your mind over?"

Concept option C: "How we built saved searches in 4 months"
  Educational native; build-in-public framing
  Hook: "Here's why a 'save button' took 4 months to build"
  Build: process breakdown with screen recordings
  Payoff: showing the shipped feature working
  Comment-prompt: "What seems simple but isn't?"
```

The user picks (or hybrids). Concept A leans creator-style;
B leans trend-participation; C leans educational native. Each
plays to a different audience response.

## Phase 2 — Generate storyboard

Per concept and length, generate a multi-frame storyboard:

```bash
pencil --out design/marketing/social/tiktok/saved-searches-launch-storyboard.pen \
       --prompt "<embedded prompt: TikTok storyboard, 5 frames over 12s,
                 9:16 vertical (1080x1920),
                 voice warmth +0.5 energy +1.0 complexity -1.0,
                 native creator-style (handheld feel, conversational),
                 frame 1 (0-2s): hook — typing the same filters frustrated POV
                 frame 2 (2-4s): pattern interrupt — discovers save button
                 frame 3 (4-7s): saving filter, getting alert (UI screen recording)
                 frame 4 (7-10s): satisfaction beat (leaning back, smiling)
                 frame 5 (10-12s): TikTok-style outro 'comment your wish-feature below'
                 burned-in captions throughout (sound-off-friendly first 2 seconds)>"
```

## Phase 3 — Generate script + audio direction

Per storyboard, produce script:

- **Voiceover** (when used) — the conversational narration
  matching the concept
- **Captions** — burned-in text per shot
- **Audio direction** — original music vs trending sound vs no
  music (TikTok-native silence works for some content)
- **Edit pacing** — cuts per second, transition style (jump
  cuts vs smooth)
- **Total runtime** — must match `--length` exactly

For the POV concept:

```
0:00–0:02  HOOK
  Visual: First-person view of typing into filter fields,
          slightly exhausted body language
  Caption: "POV: you've re-typed this filter combination 47 times this week"
  Audio: subtle ambient typing sound; no music yet
  Edit: single shot, no cuts (calm before the surprise)

0:02–0:04  PATTERN INTERRUPT
  Visual: Cursor finds a 'Save filter' button you somehow
          missed before, accent-colored highlight pulses
  Caption: "wait what is THIS"
  Audio: music kicks in — upbeat, slight comedic timing
  Edit: snap zoom into the button

0:04–0:07  REVEAL / PAYOFF
  Visual: Quick screen-recording — saving filter, named,
          coming back later, one-click reapply
  Caption: "you can just... save them"
  Audio: music continues, light melodic accent on each step
  Edit: 3 quick cuts showing the workflow

0:07–0:10  EMOTIONAL BEAT
  Visual: First-person view leaning back from monitor,
          slight headshake-and-smile gesture (relatable
          satisfaction)
  Caption: "hours back in your week"
  Audio: music settles
  Edit: hold on this beat

0:10–0:12  COMMENT PROMPT + BRAND
  Visual: Brand wordmark + 'Try saved searches' text overlay
  Caption: "what feature do you wish had a save button? ↓"
  Audio: music continues to natural fade
  Edit: clean outro

Total runtime: 12 seconds
```

## Phase 4 — Audio strategy

TikTok rewards trending audio. Three options:

1. **Trending sound** (highest reach upside)
   - Browse TikTok's "Trending Sounds" or Creative Center
   - Choose a sound that matches the concept's energy
   - Native-feeling: the sound is the platform's current
     conversation; brand joins it
   - Risk: borrowed sounds can feel inauthentic if forced

2. **Original sound / voiceover**
   - Higher production effort
   - Works when the brand has a distinctive sonic identity
   - Lower platform-virality boost vs trending sounds

3. **No music / minimal sound**
   - Common for educational native and POV content
   - Burned-in captions carry the post

The script documents the chosen audio strategy. For trending
sound use, document which trend + why fit (so the team can
verify the trend is still active before posting — trends move
fast on TikTok; what was hot last week may be played-out now).

## Phase 5 — Hashtags

TikTok hashtag strategy: 3-5 with at least one trending
hashtag.

Mix:
- **1-2 trending hashtags** (current platform-wide momentum) —
  primary discovery mechanism
- **1-2 niche-specific** — relevant to the brand's audience
- **1 brand-specific** — accumulates over time

Hashtag verification: trending hashtags shift weekly. Document
which ones fit at storyboard time, but **always re-verify
before posting** — yesterday's trending hashtag may have died.

## Phase 6 — Voice + compliance check

Standard pass. TikTok-specific:

- Voice modulation correct (most casual of any platform)
- First 2 seconds work sound-off
- Comment-prompt present at end
- Hashtag count 3-5 with trending element

Compliance:

- TikTok's aggressive enforcement against perceived clickbait
- Manufactured-urgency triggers reviews
- Native-feeling reduces ad-policy review-flag risk
- FTC disclosure if partnership (TikTok has built-in "Paid
  partnership" label — use it + caption disclosure)
- Industry regulation: financial / healthcare claims face
  extra TikTok scrutiny; "guaranteed returns" type claims
  get removed

## Phase 7 — Generate metadata

```jsonc
{
  "kind": "social-post",
  "platform": "tiktok",
  "postType": "video",
  "name": "saved-searches-launch-tiktok",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "tiktok": {
    "length": "12s",
    "style": "native",                      // native | polished | trend-participation
    "concept": "POV: you finally save your search",
    "hookType": "pattern-interrupt",
    "audioStrategy": "trending-sound",
    "trendingSound": null,                  // populated if trending sound used; verify pre-post
    "captionsStyle": "burned-in",
    "commentPrompt": "What feature do you wish had a save button? ↓",
    "hashtags": ["#worktok", "#saastips", "#productivity", "#savedsearches"]
  },
  "content": {
    "primaryText": "POV: re-typing the same filter combination 47 times finally has a fix.\n\n#worktok #saastips #productivity #savedsearches",
    "altText": null,                        // captions serve alt-text role
    "linkUrl": "in-bio"
  },
  "media": {
    "primary": "design/marketing/social/tiktok/saved-searches-launch-storyboard.pen",
    "script": "design/marketing/social/tiktok/saved-searches-launch-script.md",
    "kind": "video",
    "renderedAsset": null                   // production downstream
  },
  "scheduling": {
    "scheduledFor": "2026-05-02T19:00:00-04:00",  // 7 PM ET — TikTok evening peak
    "timezone": "America/New_York",
    "publishMode": "manual"
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "+0.5", "energy": "+1.0", "complexity": "-1.0" }
  },
  "compliance": {
    "isPartnership": false,
    "platformLabelRequired": false
  },
  "performance": {
    "hypothesis": "Native creator-style POV format earns engagement; comment-prompt drives replies (TikTok's key algorithm signal).",
    "successMetric": "comments >= 50, completion rate >= 50%, shares >= 100"
  }
}
```

## Reporting

```
✓ TikTok post generated: saved-searches-launch-tiktok

Files:
  Storyboard:  design/marketing/social/tiktok/saved-searches-launch-storyboard.pen
  Script:      design/marketing/social/tiktok/saved-searches-launch-script.md
  Rendered:    (production handoff required — see script)

Length:         12s
Style:          native creator-style
Concept:        POV: you finally save your search
Audio:          trending sound (verify trend is still active pre-post)
Captions:       burned-in (sound-off-friendly)

Voice:          Confident Mentor (warmth +0.5, energy +1.0, complexity -1.0)
Scheduled:      Friday May 2, 7:00 PM ET (TikTok evening peak)

Hashtags:       4 (#worktok #saastips #productivity #savedsearches)
                Verify trending hashtags pre-post — TikTok trends shift weekly

Compliance:
  No partnership disclosure required
  Native style reduces ad-flag risk

Action items:
  1. Production handoff: storyboard + script to creative
     team or video pipeline
  2. Audio sourcing: verify trending sound is still active
     before final edit; substitute if it's been overplayed
  3. Hashtag re-verification immediately before posting
     (trending hashtags shift fast)
  4. Plan reply-engagement: comment volume drives TikTok
     algorithm; commit to engaging with first 20-30 comments
     within 1 hour of posting
  5. Consider Stitch / Duet strategy: when other creators
     stitch this video, the engagement compounds
```

## Idempotency

Re-running overwrites. Variants with distinct slugs.

## What this command does NOT do

- **Does not produce final video.** TikTok production is
  creator/animator/video-editor work. The command produces
  storyboard + script.
- **Does not detect current trending sounds in real-time.**
  Trend research is human work (browse TikTok directly or use
  Creative Center).
- **Does not auto-post.** TikTok's API for organic posting is
  limited; manual posting or specialized scheduling tools.
- **Does not handle TikTok Live (live streaming).** Real-time
  production.
- **Does not handle TikTok Shop tagging.** E-commerce-specific.
- **Does not measure performance.** TikTok Analytics or third-
  party tools.
