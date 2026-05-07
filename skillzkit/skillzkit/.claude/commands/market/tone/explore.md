---
description: Explore N candidate brand voices along five dimensions (formality, warmth, authority, energy, complexity), each with sample copy in six contexts so the user can compare voices in concrete situations rather than abstract dimensions. Persist the chosen voice as the canonical reference for every marketing channel.
argument-hint: [--n <count>] [--informed-by <research-json>] [--seed <vibe-keywords>] [--audience <subset>] [--lock] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Explore candidate brand voices and pick one. The chosen voice
becomes the canonical reference at `product/.pencil-tone.json`,
read by every marketing channel command. Without an established
voice, channel commands have to re-elicit voice from scratch on
every run — wasteful and inconsistent.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`, and
   `market/tone/_context.md`.
2. Read `product/.pencil-brand.json` for brand context (name,
   industry, audience, audience-regulation).
3. Resolve inputs:
   - `--n <count>` — number of voice candidates. Default `3`.
     Pick `2` when the brief is unusually clear and a third
     candidate would dilute the comparison; `4-5` when
     intentional voice breadth is wanted.
   - `--informed-by <research-json>` — pulls competitor tone
     signals from research. When research includes
     `competitorsSurveyed[].tone`, the candidates can position
     against (matching the category) or away from (differentiating)
     the dominant tone.
   - `--seed <vibe-keywords>` — comma-separated keywords to bias
     candidate generation. Examples: `"warm,direct,no-fluff"`,
     `"playful,confident,specific"`, `"measured,precise,respectful"`.
     Optional; without it, candidates span a wider range.
   - `--audience <subset>` — when set, candidates are calibrated
     for a specific audience subset (read from
     `product/.pencil-marketing.json`'s `channelAudience` if it
     exists). Useful when one product serves distinct audiences
     (e.g. teachers and district administrators) and each needs
     a slightly modulated voice.
   - `--lock` — skip review and write directly. Default off
     because voice is high-stakes and review is cheap.
   - `--dry-run` — print candidates and the chosen voice's
     would-be JSON, but don't write. Use before any production
     project where voice change has cascade risk.
4. Check `product/.pencil-tone.json` — if it exists, this is a
   fresh exploration that will overwrite. Surface the existing
   voice and ask the user if they want `refine` instead (which
   evolves) or genuinely want to start over.

## Phase 1 — Calibrate from inputs

Read brief + research + seed keywords. Synthesize:

- **Industry baseline tone**: what category-typical tone looks
  like (from research, or industry priors if no research). E.g.
  "B2B ed-tech leans authoritative + warm; dev-tools leans
  direct + technical."
- **Audience expectations**: what the target audience responds
  to. K-12 administrators want measured authority; trial users
  want supportive guidance; developers want directness without
  hand-holding.
- **Brand context**: the brand JSON's `tagline` and any
  positioning hints. A tagline like "Tools that respect your
  time" already implies low formality, high warmth, peer
  authority.
- **Audience-regulation considerations**: K-12 means voice must
  work for both administrators and the parents they communicate
  with. Healthcare means clinical precision matters. Financial
  services means trustworthy authority can't slip into casual.

Output a "Read of the calibration" block. The user confirms or
corrects before candidates generate.

## Phase 2 — Generate N candidates

Each candidate has:

- **Name** — short evocative label (`"Confident Mentor"`,
  `"Quiet Specialist"`, `"Warm Builder"`)
- **Summary** — one sentence describing the voice
- **Dimensions** — five 1-5 scores (formality, warmth, authority,
  energy, complexity)
- **Pillars** — five "we ARE" + five "we ARE NOT"
- **Sample copy in six contexts** (see `market/tone/_context.md`
  for the canonical six)

Make candidates **meaningfully distinct**, not minor variations.
Three candidates clustered around (formality 3, warmth 3,
authority 3) is a failed exploration — the user can't compare
because the differences are noise. A good triad spans the space:

```
Candidate A — "Quiet Specialist"
  formality: 4, warmth: 2, authority: 4, energy: 2, complexity: 4
  ARE: precise, deliberate, expert, restrained, accurate
  ARE NOT: chatty, hedging, performative, vague, salesy
  Welcome subject line: "Your account is ready"
  Empty state: "No data. Create a project to begin."
  Error: "Save failed. Retry or contact support."
  ...

Candidate B — "Confident Mentor"
  formality: 3, warmth: 4, authority: 3, energy: 3, complexity: 3
  ARE: clear, supportive, direct, respectful, human
  ARE NOT: jargon-heavy, preachy, salesy, infantilizing, hedging
  Welcome subject line: "Welcome — let's get you set up"
  Empty state: "Nothing here yet. Create your first project to start tracking progress."
  Error: "Couldn't save just now. Your work isn't lost — try again."
  ...

Candidate C — "Warm Builder"
  formality: 2, warmth: 5, authority: 2, energy: 4, complexity: 2
  ARE: enthusiastic, encouraging, supportive, hands-on, optimistic
  ARE NOT: stiff, distant, jargon-y, preachy, gloomy
  Welcome subject line: "You're in! Let's build something great"
  Empty state: "Empty for now! Create a project to start tracking your progress."
  Error: "Hmm, that didn't save. Don't worry — try again and we'll get it through."
  ...
```

The dimensional spread across A/B/C lets the user see what each
voice does in concrete contexts. Ad-hoc voice descriptions
("more confident") rarely produce useful feedback; sample copy
in six contexts is concrete enough to react to.

## Phase 3 — Render candidates side-by-side

Print all N candidates in a comparison format. For each context,
all candidates' copy is shown together so the user can read
across:

```
=== Welcome subject line ===
A: "Your account is ready"
B: "Welcome — let's get you set up"
C: "You're in! Let's build something great"

=== Dashboard empty state ===
A: "No data. Create a project to begin."
B: "Nothing here yet. Create your first project to start tracking progress."
C: "Empty for now! Create a project to start tracking your progress."

=== Error message (save failed) ===
A: "Save failed. Retry or contact support."
B: "Couldn't save just now. Your work isn't lost — try again."
C: "Hmm, that didn't save. Don't worry — try again and we'll get it through."

(... 3 more contexts ...)
```

This format reveals voice differences faster than reading each
candidate's full bio in isolation. The user picks based on what
they hear, not what's described.

Optionally render to a `.pen` for visual review when scaffolding
a brand presentation:

```bash
# When --render is set:
pencil --out design/explorations/tone-candidates.pen \
       --prompt "<embedded prompt that lays out the 3 candidates side by side>"
```

## Phase 4 — User picks (or hybrids)

Three accept paths:

- **Pick one** — "B" or "Confident Mentor"
- **Hybrid** — "B's warmth with C's energy" or "B but pull
  authority down to 2". The command synthesizes the hybrid
  voice and shows the resulting sample copy for confirmation
  before persisting.
- **None of these** — request another round with adjusted seed
  or feedback ("more measured, less hand-holdy"). Re-run Phase
  2 with the new constraints.

For hybrid mode, the synthesis is generative — given component
candidates, produce the hybrid's full dimensional + pillar +
example set. Show the result before persisting.

## Phase 5 — Persist

When the user confirms (or `--lock`):

```bash
# Write to product/.pencil-tone.json
```

The file format is documented in `market/tone/_context.md`. Include:

- `version: 1`
- `establishedAt: <ISO>`
- `lastRefinedAt: <ISO>` (same as establishedAt for first run)
- `name`, `summary`, `dimensions`, `pillars`, `examples`,
  `vocabulary`, `guidelines`

The vocabulary section ("preferred" / "avoid") is generated as
part of the chosen voice — words that fit the dimensions and
pillars, words that don't.

The guidelines section is a short list of operational rules
implied by the dimensional choices ("use second person", "active
voice", "short sentences for emphasis"). Generated, not boilerplate.

When `--dry-run` is set, print the JSON that would be written and
stop. The user reviews and re-runs without `--dry-run` to commit.

## Phase 6 — Brief the team

After persisting, optionally generate a one-page tone brief
suitable for sharing:

```bash
# Output: design/marketing/tone-brief.md
```

This is the human-facing reference card — derived from the JSON
but written for readers who won't open a JSON file. Includes the
name, summary, dimensional spider chart (ASCII or markdown table),
pillars, and the six sample-context examples.

## Reporting

Illustrative — adapt to the actual exploration:

```
✓ Tone established: "Confident Mentor"

Source:        product/.pencil-tone.json
Brief:         design/marketing/tone-brief.md (optional, on request)

Dimensions:
  Formality:  3 / 5  (professional warm)
  Warmth:     4 / 5  (warm)
  Authority:  3 / 5  (knowledgeable mentor)
  Energy:     3 / 5  (confident)
  Complexity: 3 / 5  (educated adult)

Channels can now read .pencil-tone.json. Run any
/market:* command and the established voice applies.

Test copy against this voice with /market:tone:test.
Refine the voice over time with /market:tone:refine.
```

## Idempotency

Re-running tone:explore on a project with established voice
overwrites — but the command always confirms first (Pre-flight
step 4). For evolution rather than replacement, use
`/market:tone:refine`.

The previous voice is preserved as
`product/.pencil-tone.<timestamp>.json` (backup) so rollback
via git or manual restoration stays cheap.

## What this command does NOT do

- **Does not establish brand identity beyond voice.** Tone is
  verbal; brand identity also includes visual treatment (handled
  by `product/design/foundations/*-select` commands).
- **Does not write production copy.** The examples in
  .pencil-tone.json are reference samples, not deliverable copy.
  Channel commands produce production copy informed by tone.
- **Does not handle multi-language voice translation.** When
  brand JSON's `i18n.scripts` includes non-Latin scripts, the
  established voice may need per-language calibration — that's
  out of scope for this command. Document language-specific
  voice notes in `product/.pencil-marketing.json` instead.
- **Does not auto-update channel copy when refined later.** A
  `tone:refine` invocation establishes a new voice; existing
  channel copy stays as-is. Migrating existing copy to the
  refined voice is per-channel work, surfaced by audit.
