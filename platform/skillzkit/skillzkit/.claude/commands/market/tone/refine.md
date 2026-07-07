---
description: Evolve the established voice based on feedback ("examples felt too corporate; pull warmth higher", "drop authority, this isn't selling expertise"). Reads the existing voice, applies surgical changes, regenerates affected sample copy, and confirms before persisting. Distinct from `explore` (full re-discovery) — refine preserves continuity while moving the voice deliberately.
argument-hint: <feedback-or-direction> [--shift <dimension>=<delta>]... [--add-pillar <are|are-not> <label>]... [--remove-pillar <label>]... [--vocab-add preferred|avoid <word>]... [--regenerate-examples] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Evolve the established voice deliberately. `tone:explore` is for
fresh discovery; `tone:refine` is for surgical adjustment of a
voice that's already in production. Use this when the voice mostly
works but a specific axis needs to shift, or when feedback has
surfaced consistent drift requests.

## When to use refine vs explore

| Situation                                                | Command                |
| -------------------------------------------------------- | ---------------------- |
| No established voice yet                                 | `explore`              |
| Voice exists; minor feedback ("less salesy", "warmer")   | `refine`               |
| Voice exists; one dimension off                          | `refine --shift`       |
| Voice exists; want to add/remove pillars                 | `refine --add-pillar`  |
| Voice exists; expanding to new audience that needs different voice | `explore --audience` (creates audience-specific variant) |
| Voice has drifted unrecognizably; want fresh start       | `explore`              |
| Brand pivot or repositioning                             | `explore`              |

The shorthand: refine preserves the voice's identity. Explore
creates a new identity.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`, and
   `market/tone/_context.md`.
2. Read `product/.pencil-tone.json`. If it doesn't exist:
   "No established voice. Run /market:tone:explore first." Stop.
3. Resolve inputs:
   - First positional: feedback or direction. Free-form text:
     `"examples feel too corporate; pull warmth higher"`,
     `"drop authority — we're not trying to sell expertise"`,
     `"the error messages still feel cold"`. The command parses
     this into structured changes.
   - `--shift <dim>=<delta>` — surgical dimension shift. E.g.
     `--shift formality=-1` (move formality from 3 to 2),
     `--shift warmth=+1`. Multiple shifts are allowed; combined
     shifts of >2 dimensions of >1 each are a red flag (probably
     wants `explore`, not `refine`).
   - `--add-pillar <are|are-not> <label>` — add a pillar. E.g.
     `--add-pillar are-not "performative"`. Hard cap at 5 ARE +
     5 ARE-NOT; adding past 5 requires removing one first.
   - `--remove-pillar <label>` — remove an existing pillar.
   - `--vocab-add preferred|avoid <word>` — add to vocabulary
     lists.
   - `--regenerate-examples` — regenerate the six sample-context
     examples to reflect the refined voice. Default off (preserves
     existing examples for continuity); on when the dimensional
     shifts are large enough that old examples no longer represent
     the voice.
   - `--dry-run` — show the would-be JSON and confirm before
     writing.

## Phase 1 — Parse feedback into structured changes

Free-form feedback gets translated into the structured operations
above. The translation should be transparent — show the user what
the command interpreted before applying:

```
You said: "examples feel too corporate; pull warmth higher"

Interpreted as:
  - --shift warmth=+1   (3 → 4)
  - --regenerate-examples (warmth shift affects most contexts)

Implicit additions:
  - vocabulary: consider adding "we" / "you" / "let's" to preferred
  - vocabulary: consider adding "leverage" / "synergize" to avoid

Confirm? [Y/n]
```

If the user disagrees with the interpretation, they can re-run
with explicit flags. The free-form-to-structured translation is
inference; it can miss intent.

## Phase 2 — Apply changes to the in-memory voice

Load the current `.pencil-tone.json`. Apply each change:

```
Before:
  formality: 3, warmth: 3, authority: 3, energy: 3, complexity: 3
  ARE: clear, supportive, direct, respectful, human
  ARE NOT: jargon-heavy, preachy, salesy, infantilizing, hedging

After applying --shift warmth=+1, --add-pillar are-not "stiff":
  formality: 3, warmth: 4, authority: 3, energy: 3, complexity: 3
  ARE: clear, supportive, direct, respectful, human                  (unchanged)
  ARE NOT: jargon-heavy, preachy, salesy, infantilizing, stiff       (replaced "hedging" with "stiff" — cap at 5; ask user which to drop)
```

When pillar additions push past 5, surface and ask:

```
You're at the 5-pillar cap for ARE-NOT. To add "stiff", drop one of:
  1. jargon-heavy
  2. preachy
  3. salesy
  4. infantilizing
  5. hedging

Pick a number or pass --remove-pillar <label> explicitly.
```

## Phase 3 — Regenerate affected examples

When `--regenerate-examples` is on (or when shifts are large
enough that examples must update):

For each of the six sample contexts, regenerate copy that fits
the refined voice. Show old + new side-by-side:

```
Welcome subject line:
  Before:  "Welcome — let's get you set up"
  After:   "Welcome! We're so glad you're here — let's get started"

Dashboard empty state:
  Before:  "Nothing here yet. Create your first project to start tracking progress."
  After:   "It's empty for now. Create your first project and we'll help you get going."

(... 4 more contexts ...)
```

When `--regenerate-examples` is **off**, preserve existing
examples and surface a warning:

```
⚠ Examples not regenerated. After warmth shift +1, existing
  examples may no longer represent the new voice. Run with
  --regenerate-examples or manually update before relying on
  them as voice references.
```

## Phase 4 — Update vocabulary

When the dimensional shift implies vocabulary changes, surface
suggestions:

```
Warmth shift +1 implies vocabulary updates:

  Add to preferred:  "let's", "together", "we", "you" (already
                     in preferred — no change)
  Add to avoid:      "ensure", "facilitate", "utilize" (more
                     formal/distancing)

Apply? [Y/n] (or use --vocab-add to specify)
```

The user confirms or overrides. Vocabulary lists can grow
substantially — don't aim for symmetry; aim for usefulness.

## Phase 5 — Confirm and persist

Show the full diff between old and new `.pencil-tone.json`:

```
=== Diff ===

  "lastRefinedAt": "2026-05-02T18:42:00Z" → "2026-12-15T11:20:00Z",
  "dimensions": {
    "formality": 3,
    "warmth": 3 → 4,           [+1]
    "authority": 3,
    "energy": 3,
    "complexity": 3
  },
  "pillars": {
    "are_not": [
      ...
      "hedging" → "stiff"      [replaced]
    ]
  },
  "examples": {
    "welcome_subject_line": "Welcome — let's get you set up"
                          → "Welcome! We're so glad you're here — let's get started",
    ...
  },
  "vocabulary": {
    "avoid": [
      ...
      + "ensure",
      + "facilitate",
      + "utilize"
    ]
  }

Confirm and write? [Y/n]
```

When confirmed:

1. Backup the existing voice as
   `product/.pencil-tone.<timestamp>.json` (so this refinement is
   reversible).
2. Write the refined voice to `product/.pencil-tone.json`.
3. Update `lastRefinedAt` to the current ISO timestamp.
4. Optionally regenerate `design/marketing/tone-brief.md` if it
   exists (the human-facing one-page reference).

When `--dry-run` is set, print the diff and stop. The user re-runs
without `--dry-run` to commit.

## Phase 6 — Surface ripple effects

Refining tone has cascading effects on existing channel work. The
command surfaces what's potentially out of sync now:

```
Voice refined. Potential ripple effects:

  Existing channel collateral (read for awareness, not auto-updated):
    design/marketing/email/welcome.pen     (last touched 2026-04-12)
    design/marketing/email/newsletter.pen  (last touched 2026-04-28)
    design/marketing/social/x-launch.pen   (last touched 2026-04-30)

  These may now read off-voice. Run /market:tone:test against
  each to assess fit. Refining the voice does not auto-update
  existing copy — that's per-channel work.

  Recommendation: run audit Plane 8 (voice-consistency) against
  the corpus when you're ready to address drift.
```

This isn't a fail; it's awareness. The team decides which existing
collateral to update vs. let age out.

## Reporting

Illustrative — adapt to the actual refinement:

```
✓ Voice refined: "Confident Mentor" (warmth 3→4)

Source:           product/.pencil-tone.json
Backup:           product/.pencil-tone.2026-12-15T11-20-00Z.json
Brief regenerated: design/marketing/tone-brief.md (when present)

Changes applied:
  Dimension:  warmth 3 → 4
  Pillars:    "hedging" → "stiff" (in ARE-NOT)
  Vocabulary: +3 avoid words (ensure, facilitate, utilize)
  Examples:   regenerated (6 contexts)

Existing channel collateral may now read off-voice — run
/market:tone:test on key pieces to assess fit.
```

## Idempotency

Re-running refine with identical changes is a no-op (the diff
shows no changes, nothing is written). The timestamp is the only
side effect, and only updates when actual changes are committed.

Backups accumulate in `product/.pencil-tone.<timestamp>.json` —
rotate manually or via a periodic cleanup. Keep the last 5 by
default.

## What this command does NOT do

- **Does not auto-update existing channel copy.** Refinement
  changes the voice reference; existing copy stays as-is until
  per-channel commands are re-run or copy is manually revised.
- **Does not split the voice into audience-specific variants.**
  When one product needs meaningfully different voice for distinct
  audiences (e.g. teachers vs. district administrators), use
  `tone:explore --audience <subset>` to create a parallel voice
  variant in `.pencil-marketing.json`'s per-audience overrides.
  Refinement is for evolving the canonical voice, not for
  creating variants.
- **Does not change brand identity beyond voice.** Visual
  refinement is separate (`product/design/foundations/*-select`).
- **Does not regenerate the tone-brief.md** automatically unless
  it already exists. Generation only happens when the brief was
  previously generated and the refinement is meaningful enough
  that the brief is now stale.
