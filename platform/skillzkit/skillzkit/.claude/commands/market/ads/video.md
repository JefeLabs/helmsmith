---
description: Generate video ads — YouTube TrueView (skippable + non-skippable), pre-roll across platforms, Meta in-stream, TikTok, programmatic, and Connected TV. Produces storyboard .pen + script + rendered .mp4 (when production toolchain available) + metadata. Length tiers (6s bumper / 15s / 30s / longer); sound-off-friendly visual treatment; first-3-second hook discipline.
argument-hint: <campaign-slug> [--length 6s|15s|30s|60s|90s] [--platform youtube|meta|tiktok|x|programmatic|ctv] [--mode performance|brand] [--orientation horizontal|vertical|square] [--audience <subset>] [--landing <url-or-pen-path>] [--informed-by <brief-slug>] [--cta-style soft|direct|urgent] [--storyboard-only] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate video ads. Video is the highest-investment ad format,
the most attention-effective when it works, and the most
attention-wasted when it doesn't. The first 3 seconds carry the
campaign — viewers either keep watching or scroll past, and
the threshold is brutal.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/ads/_context.md`, `product/.pencil-tone.json`, and
   (when established) `product/.pencil-editorial.json`.
2. Read `product/.pencil-brand.json` for visual identity, brand
   sound (if defined — sonic logo, music palette).
3. Resolve inputs:
   - First positional: campaign slug.
   - `--length 6s|15s|30s|60s|90s` — video duration. Common
     tiers below.
   - `--platform youtube|meta|tiktok|x|programmatic|ctv` —
     default `youtube`. Each platform has different conventions.
   - `--mode performance|brand` — default `brand` for video
     (most video buys are brand-leaning); switch to
     `performance` for direct-response video.
   - `--orientation horizontal|vertical|square` — default
     `horizontal` (16:9 / 1920x1080) for YouTube/TV;
     `vertical` (9:16 / 1080x1920) for TikTok/Reels/Stories;
     `square` (1:1 / 1080x1080) for feed-friendly cross-platform.
   - `--audience <subset>` — channel audience.
   - `--landing <url-or-pen-path>`.
   - `--informed-by <brief-slug>`.
   - `--cta-style soft|direct|urgent`.
   - `--storyboard-only` — generate the storyboard `.pen` and
     script without expecting `.mp4` output. Default off; the
     command attempts production rendering when the toolchain
     supports it.
4. Verify: video production typically requires external tools
   (After Effects, Premiere, Descript, Runway, etc.). The
   command produces a storyboard + shot-list + script that
   feeds production; rendered `.mp4` output depends on the
   project's video pipeline.

## Length tiers

Each platform supports specific durations:

| Length | Platform conventions | Use case |
| ------ | -------------------- | -------- |
| **6s**  | YouTube Bumper Ads (non-skippable) | Maximum attention budget; one idea, branded; brand recall play |
| **15s** | YouTube TrueView skippable, Meta in-stream, TikTok | Most common; full message arc possible |
| **30s** | YouTube longer skippable, programmatic, CTV | More room for story; risk of skip is real |
| **60s** | Brand storytelling, CTV, premium placements | Brand mode strongly preferred |
| **90s+** | Long-form / online-only | Non-paid distribution typically; YouTube channel content |

The 6-second bumper is its own discipline — extreme compression,
visual lead, brand at end. 15-second is the most common ad-buy;
the format that most buyers default to for performance video.
30-second carries a fuller arc but fights skip-rate. 60s+ is
brand-storytelling territory.

## First 3 seconds — the hook

Whatever the length, the first 3 seconds carry the campaign:

- **Sound-off design** — autoplay on most platforms is muted.
  The visual must communicate without sound. Visible captions
  for any spoken copy.
- **Frame 1 must be visually arresting** — not a logo intro;
  not a slow camera move; not a gentle fade-in. The viewer's
  thumb is hovering over the skip button.
- **The hook earns the next 3 seconds** — and so on, every
  3-second beat is a re-attention point. Viewers who pass the
  first hook still skip if the second beat doesn't deliver.
- **Brand within 5 seconds** — even brand ads benefit from
  showing the brand early. Don't rely on viewers staying for the
  end-card to learn whose ad they watched.

The 3-second discipline is non-negotiable. A cinematically
beautiful ad that takes 7 seconds to land its hook will
underperform a structurally simple ad that hooks in 2.

## Sound-off-friendly design

Most platforms autoplay muted (until the viewer engages):

- **Captions** — burned-in (open captions) for performance ads;
  closed captions toggleable for brand. Caption typography
  should be readable at small sizes, contrast-strong against
  any background.
- **Visual storytelling primary** — the ad should communicate
  its message via visuals alone. Sound enhances; doesn't carry.
- **Music + SFX** when sound-on, but the ad shouldn't depend on
  hearing the music.
- **Voiceover** — when used, paired with caption text always.
  Voiceover-only with no captions is failure for performance
  contexts.

## Platform-specific conventions

**YouTube**:
- Skippable in-stream (TrueView): viewer can skip after 5s. Hook
  hard for the first 5s, then deliver.
- Non-skippable in-stream: 15s typically; whole ad plays.
  Discipline still matters — viewer attention isn't captive.
- Bumper: 6s, non-skippable.
- End screen: 5-20s overlay with CTA + subscribe + related
  videos. Use it.

**Meta (Facebook + Instagram)**:
- In-stream: 5-15s typical.
- Feed video: 5-60s (longer rarely performs).
- Stories / Reels: 15s vertical; designed for full-screen
  immersion, sound-off-by-default but sound-on-engagement-
  triggered.

**TikTok**:
- 9-15s sweet spot (long-form is platform's organic content;
  ads shorter performs better).
- Native-feeling: ads that look like organic TikTok perform
  better. Avoid corporate-polish; embrace platform aesthetics.
- Sound-on engagement is higher than other platforms;
  sound-design matters more.

**X**:
- 15-60s in-stream; 6-15s sweet spot.
- Less established as a video-ad platform than others;
  performance varies.

**Programmatic** (DV360, TTD, StackAdapt):
- Standard durations apply (15s, 30s, 60s).
- VAST/VPAID-compliant tags for tracking.

**Connected TV (CTV)**:
- 15s, 30s, 60s standard (matching traditional broadcast).
- Sound-on viewing (large-screen context).
- No skip; whole ad plays.
- Brand mode predominant; performance attribution is harder.
- Typical buyer: Roku, Hulu, Samsung Ads, Pluto, FreeWheel,
  Magnite — programmatic CTV ecosystem.

## Phase 1 — Determine creative direction

Before storyboarding, establish:

- **Story arc**: hook → setup → payoff → CTA. Each beat scaled
  to length tier:
  - 6s: hook (1s) → product moment (3s) → brand + CTA (2s)
  - 15s: hook (3s) → setup (4s) → payoff (5s) → CTA (3s)
  - 30s: hook (3s) → setup (8s) → payoff (12s) → CTA (5s) +
    brand outro (2s)
- **Hook type**: visual surprise, question, problem statement,
  pattern interrupt
- **Tone**: matches voice modulation per
  `market/ads/_context.md` performance-video or brand-video
  rows
- **Music + sound design**: brand sonic elements + supporting
  music; cued to story beats
- **Captions style**: integrated with brand typography;
  positioned to not occlude key visual elements

## Phase 2 — Generate storyboard

Storyboard as a multi-frame `.pen` file. Each frame = one shot
in the video. Frame count varies by length:

- 6s: 3-5 frames (one idea, minimal cuts)
- 15s: 6-10 frames (typical)
- 30s: 12-20 frames
- 60s: 20-40 frames

Each frame includes:

- **Visual sketch** — what the viewer sees
- **Camera/motion notes** — "static product close-up", "push in
  on dashboard", "talking-head with cut to product"
- **Caption text** — burned-in or closed-caption text per shot
- **Voiceover text** (when used) — keyed to the shot
- **Duration** — seconds for that shot
- **Music/SFX cue** — what the audio is doing

Example storyboard frame for the launch-saved-searches campaign,
15s vertical for Reels/TikTok:

```
Frame 1 (0:00–0:02):
  Visual: Hands typing the same search filters, keyboard close-up,
          warm lighting, slight motion blur on hands
  Caption: "Filtering the same way. Again."
  VO: (none — visual leads)
  Music: building beat, bass-heavy
  Note: hook — universal frustration moment

Frame 2 (0:02–0:04):
  Visual: Cut to product UI, filter sidebar with "Save filter" button
          highlighted by accent color glow
  Caption: "Save it once."
  VO: (none)
  Music: continues, light melodic accent
  Note: solution reveal

Frame 3 (0:04–0:08):
  Visual: Quick cuts: filter being saved → list of saved filters →
          one-click application → results loading
  Caption: "One click. Reusable. Always there."
  VO: (none)
  Music: builds
  Note: payoff sequence; show the workflow

Frame 4 (0:08–0:12):
  Visual: User leaning back, smiling slightly, dashboard visible
          on screen behind them
  Caption: "Hours back in your week."
  VO: (none)
  Music: peaks, then settles
  Note: emotional payoff

Frame 5 (0:12–0:15):
  Visual: Brand logo + "Try saved searches" CTA in brand accent button
  Caption: "Acme — try saved searches free"
  VO: "Acme — try saved searches free"
  Music: brand sonic logo
  Note: brand + CTA outro
```

Storyboard `.pen` file:

```bash
pencil --out design/marketing/ads/video/launch-saved-searches-q2-2026-15s.pen \
       --prompt "<embedded prompt: 15-second vertical video ad storyboard,
                 5 frames at 9:16 aspect (1080x1920),
                 voice modulation -0.5 warmth +1.0 energy -0.5 complexity,
                 hook (problem) → solution reveal → workflow payoff →
                 emotional payoff → brand+CTA,
                 first 3 seconds: hands-on-keyboard-frustration moment>"
```

## Phase 3 — Generate script

Distinct from the storyboard, produce a written script that the
production team works from. The script captures:

- Per-shot duration
- Voiceover (when present) with phonetic guidance for tricky
  words
- Caption text
- Audio direction (music type, SFX moments, sonic-logo placement)
- Production notes (talent direction, lighting, camera type
  recommendations) — these are advisory; production crew has
  final call
- Total runtime (must match `--length` exactly; off-by-half-second
  is a polished-vs-amateur signal)

Output: `design/marketing/ads/video/<campaign-slug>-<length>-script.md`

## Phase 4 — Voice + compliance check

Per-frame caption + voiceover passes through:

- Voice + modulation check (mental `tone:test`)
- Editorial check (capitalization, punctuation, terminology)
- Compliance: FTC disclosure if sponsored/influencer; industry
  regulations (financial disclaimers, healthcare fair-balance);
  banned-claim check ("guaranteed", "best", "proven" without
  substantiation)
- Brand-fit check: does the visual treatment fit the established
  brand visual identity? Or is this an intentional brand-extension
  moment?

## Phase 5 — Production handoff (or render)

When `--storyboard-only` is set: the deliverable is the
storyboard `.pen` + script + metadata. Production happens
externally.

When the project has a video toolchain integrated (Runway,
Descript, custom pipeline), the command may render `.mp4`
output directly. This is project-specific; document in
`market/_context.md` if the team has a configured pipeline.

For most projects, storyboard-only is the right output. Video
production touches creative directors, animators, voiceover
talent, music licensing — work that can't be auto-generated
even with strong AI tooling. The command's job is to produce
the strategic + scripted deliverable that production builds
from.

## Phase 6 — Metadata JSON

Per `market/ads/_context.md` schema, with video-specific
fields:

```jsonc
{
  "kind": "ad",
  "subType": "video",
  "campaignSlug": "launch-saved-searches-q2-2026",
  "platform": "youtube",
  "mode": "brand",
  "video": {
    "length": "15s",
    "orientation": "vertical",                  // horizontal | vertical | square
    "format": "1080x1920",
    "frameCount": 5,
    "storyArc": "hook-setup-payoff-cta",
    "hookType": "problem-statement",
    "soundDesign": {
      "approach": "music-led",
      "soundOffFriendly": true,
      "captionsStyle": "burned-in"
    },
    "storyboard": "design/marketing/ads/video/launch-saved-searches-q2-2026-15s.pen",
    "script": "design/marketing/ads/video/launch-saved-searches-q2-2026-15s-script.md",
    "renderedAsset": null                       // populated when production-rendered .mp4 exists
  },
  "audience": { ... },
  "creative": { ... },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "-0.5", "energy": "+1.0", "complexity": "-0.5" }
  },
  "compliance": {
    "isMarketing": true,
    "regions": ["US", "CA", "UK"],
    "requiresFTCDisclosure": false,
    "industryRegulation": null,
    "requiredDisclaimers": [],
    "audienceRegulation": null
  },
  "performance": {
    "hypothesis": "Vertical hook-led video drives mid-funnel awareness for trial-stalled users.",
    "successMetric": "view-through rate + completion rate",
    "targetVTR": 0.35,
    "targetCompletionRate": 0.55
  },
  "landing": { ... }
}
```

## Reporting

```
✓ Video ad generated: launch-saved-searches-q2-2026 (15s vertical)

Storyboard: design/marketing/ads/video/launch-saved-searches-q2-2026-15s.pen
Script:     design/marketing/ads/video/launch-saved-searches-q2-2026-15s-script.md
Rendered:   (production handoff required — see script)

Length:     15s vertical (9:16, 1080x1920)
Platform:   YouTube primary; works for Reels/TikTok/Shorts cross-post
Mode:       brand
Frames:     5 storyboard frames

Story arc:
  0:00–0:02  Hook    (problem moment: hands re-typing filters)
  0:02–0:04  Reveal  (save-filter UI moment)
  0:04–0:08  Payoff  (workflow speed-up sequence)
  0:08–0:12  Emotion (user satisfaction beat)
  0:12–0:15  Brand   (logo + CTA "Try saved searches free")

Sound:      music-led, sound-off-friendly, burned-in captions
Voice:      Confident Mentor (warmth -0.5, energy +1.0)

Compliance:
  No FTC disclosure required (display contextually obvious)
  No industry regulation flagged
  All claims substantiable

Action items:
  1. Review storyboard against brand visual identity
  2. Production handoff: script.md + storyboard.pen to
     production team / agency / video pipeline
  3. After production: place rendered .mp4 alongside metadata,
     update video.renderedAsset field
  4. Verify pairing with landing page:
     /market:ads:landing audit launch-saved-searches-q2-2026
  5. Submit to YouTube Ads (or other platform); note that CTV
     buys typically require 16:9 horizontal — generate a
     horizontal variant if CTV is in plan
```

## Cross-orientation strategy

A campaign often needs multiple orientations: 16:9 for YouTube/CTV,
9:16 for Reels/TikTok/Shorts, 1:1 for square feed placements.

Best practice: produce ONE storyboard that works across
orientations rather than three independent storyboards. This
keeps message consistent. The command can run multiple times
with different `--orientation` values, sharing the campaign-slug;
the script and storyboards adapt the framing per orientation
while preserving story.

## Idempotency

Re-running with the same campaign-slug + `--length` +
`--orientation` overwrites. For variant tests, use distinct
slugs. For multi-orientation, vary the `--orientation` flag —
filenames include orientation to disambiguate.

## What this command does NOT do

- **Does not produce final video files** (in most cases). Video
  production requires creative directors, talent, music
  licensing, post-production. The command produces the strategic
  + scripted deliverable.
- **Does not procure music or voiceover.** Royalty-free libraries
  (Artlist, Epidemic Sound) or custom commissioning is project
  work.
- **Does not handle live-action shoot logistics.** When live
  action is part of the storyboard, production is downstream
  work.
- **Does not auto-generate captions from voiceover.** Caption
  text comes from the script as authored; production tools
  burn them in.
- **Does not test ad against platform policy in real-time.**
  Each platform's review happens at submission. The metadata
  flags policy-relevant fields for pre-submission audit.
