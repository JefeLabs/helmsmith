---
description: Rate a piece of copy against the established voice. Surface dimensional drift (e.g. "this reads as formality 4 but the established voice is 3"), pillar violations (e.g. "this hits 'salesy' in the ARE-NOT list"), and concrete revision suggestions. Useful for ad-hoc copy review and as a CI gate for marketing collateral.
argument-hint: <copy-text-or-file-path> [--context welcome-subject|empty-state|error|hero|social-post|confirmation|other] [--strict] [--suggest]
allowed-tools: Read, Write, Edit, Bash
---

Validate a piece of copy against the established voice. Reads
`product/.pencil-tone.json`, scores the copy on each dimension,
checks against pillars, and surfaces concrete revision suggestions
when the fit is off.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`, and
   `market/tone/_context.md`.
2. Read `product/.pencil-tone.json`. If it doesn't exist, surface:
   "No established voice. Run /market:tone:explore first." Stop.
3. Resolve inputs:
   - First positional: copy text (in quotes) OR a file path
     (`@path/to/copy.txt` or `@path/to/email.md`)
   - `--context` — what kind of copy this is. Helps the analysis
     account for medium-specific modulation (a 160-char SMS
     legitimately reads tighter than a marketing hero; an error
     message legitimately reads more direct than a welcome).
     Values: `welcome-subject`, `empty-state`, `error`, `hero`,
     `social-post`, `confirmation`, `other`. Default `other`.
   - `--strict` — treat any pillar violation or dimension drift
     >0.5 as a fail. Use in CI gating. Default off (informational).
   - `--suggest` — generate revision options. Default on.

## Phase 1 — Score dimensions

Read the copy and infer where it lands on each of the five
dimensions. Compare to the established voice's dimensional scores.

For each dimension, output:

```
Formality:
  Established voice: 3 (professional warm)
  This copy reads as: 4 (business formal)
  Drift: +1 — your copy is more formal than the brand voice
```

Drift bands:
- **0.0-0.5**: in-bounds, no flag
- **0.5-1.0**: minor drift, info-level
- **1.0-2.0**: notable drift, warn-level
- **2.0+**: major drift, the copy is in a different voice space

Multiple dimensions drifting in the same direction is more
significant than one drifting alone. Surface combined patterns:
"Formality +1 + Authority +1 = the copy reads more like a corporate
press release than the brand's mentor voice."

## Phase 2 — Check pillars

For each of the five "we ARE" pillars: does the copy embody it?
For each of the five "we ARE NOT": does the copy violate it?

```
Pillars check:
  ✓ clear        — copy is direct and unambiguous
  ✓ supportive   — acknowledges reader context
  ✓ direct       — says what's true without burying the lede
  ⚠ respectful   — "users" repeated 3x feels distancing
  ✓ human

  ❌ "salesy"     — "transform your workflow today!" hits this
  ✓ "preachy"    — no signs
  ✓ "jargon-heavy"
  ✓ "infantilizing"
  ✓ "hedging"
```

Pillar violations are higher signal than dimensional drift —
dimensions are calibrations, pillars are explicit boundaries.

## Phase 3 — Vocabulary check

Cross-check against the voice's `preferred` and `avoid`
vocabulary lists:

```
Vocabulary:
  ⚠ Used "leverage" — voice's `avoid` list flags this
  ⚠ Used "world-class" — voice's `avoid` list flags this
  ✓ Used "set up" (preferred form)
  ⚠ Used "click here" — voice's `avoid` list flags this
```

These are explicit pattern matches. Easy to fix; high payoff for
copy consistency.

## Phase 4 — Context-specific check

When `--context` is set, account for medium-specific modulation
documented in `market/<channel>/_context.md`:

- **`welcome-subject`**: 30% shorter than spoken voice; warmth
  unchanged; energy slightly lifted (+0.5)
- **`empty-state`**: warmth slightly elevated; complexity slightly
  reduced; authority unchanged
- **`error`**: warmth elevated (acknowledge frustration); energy
  unchanged or slightly lowered; specific over abstract is critical
- **`hero`**: voice fully expressed; no modulation; this is the
  brand's most public copy
- **`social-post`**: platform-specific. Without per-platform
  context the check assumes general social conventions
- **`confirmation`**: warmth elevated (celebrate completion);
  authority unchanged; brevity high
- **`other`**: no context-specific modulation; check raw against
  established voice

If the copy passes the dimensional and pillar checks but fails
context-specific modulation, surface separately:

```
Context-specific check (welcome-subject):
  ⚠ Subject line is 11 words — welcome-subject convention is
    ≤7 words. Voice can fit; medium constrains length.
  Suggestion: "Welcome — let's get you set up" (6 words)
```

## Phase 5 — Suggest revisions (when `--suggest`)

Generate 1-3 revision options that address the surfaced issues
while preserving the copy's intent. Show original + revisions
side by side:

```
Original:
  "We are excited to inform you that you can now leverage our
   world-class platform to transform your daily workflow!"

Issues:
  - Formality +2 ("We are excited to inform you" / "we can now")
  - Vocabulary: "leverage", "world-class", "transform" all on avoid list
  - Pillar violation: "salesy" (exclamation + transform + world-class)

Revision A (closer to established voice):
  "Saved searches are live. They'll cut the time you spend
   re-finding things you've already searched for."

Revision B (preserves urgency you might've intended):
  "We just shipped saved searches. You can find what you need
   in seconds, not minutes."

Revision C (minimal change, fixing the worst drift):
  "We're glad to share that you can now use our platform to
   improve your daily workflow."
```

Surface the trade-offs explicitly — A drops the implicit "we
shipped this" framing; B preserves it but reorders; C is closest
to the original but still misses the brand's directness.

## Phase 6 — Result + exit code

Final output combines all phases:

```
Tone fit: B — close but with concerns

Dimensional drift:    Formality +1.5
                      Energy +1.0
Pillar violations:    "salesy" (1 hit)
Vocabulary issues:    3 avoid-list words
Context check:        OK (no --context specified)

Severity: warn

Revisions: 3 options above. Pick one or iterate manually.
```

Exit codes:
- `0` — fit (no drift > 0.5, no pillar violations, no vocabulary
  issues)
- `1` — minor concerns (drift 0.5-1.0, no pillar violations)
- `2` — fail (drift > 1.0, OR pillar violation, OR `--strict` and
  any non-zero issues)

`--strict` exit-2 makes this command CI-gate-able for marketing
collateral PRs.

## Use cases

**Ad-hoc copy review** — paste a draft into the command, get a
fit rating and revisions. Faster than gut-check during a marketing
review meeting.

**CI gate** — run on every PR that modifies marketing copy. Use
`--strict` and gate on exit 2:

```bash
# In CI:
for f in $(git diff --name-only main HEAD | grep '\.\(md\|mdx\|tsx\)$'); do
  # extract copy from the file (heuristic: visible text in JSX strings,
  # markdown body, frontmatter description fields)
  /market:tone:test "<copy>" --strict --context other
done
```

**Periodic voice audit** — run across a corpus of recent marketing
output to detect drift. Aggregate the per-piece scores and surface
the systemic patterns.

## What this command does NOT do

- **Does not auto-rewrite copy.** Suggestions are options for human
  selection, not destructive replacements.
- **Does not detect spelling or grammar errors.** Use a separate
  linter for style mechanics; this command is voice-only.
- **Does not handle non-English copy** consistently. Voice
  translation is a separate concern; for non-English copy, this
  command's dimensional analysis is approximate at best.
- **Does not validate factual accuracy.** "Best-in-class" might be
  on the avoid list as voice; whether a specific claim is accurate
  is out of scope.
