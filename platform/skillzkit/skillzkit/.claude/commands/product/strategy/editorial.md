---
description: Establish or audit editorial style for the project — the mechanical and structural conventions that distinguish "sounds polished" from "feels professional." Three modes: --explore (present 2-3 candidate styles, user picks), --from <reference> (bootstrap from a named style guide like AP/Chicago/MailChimp), --audit (scan existing artifacts for de facto style). Output is product/.pencil-editorial.json plus an optional human-readable editorial-style.md. Distinct from /market:tone:explore — tone is voice/character; editorial is mechanical-style consistency (capitalization, punctuation, numbers, dates, terminology).
argument-hint: [--explore | --from ap|chicago|mailchimp|github|microsoft|custom | --audit] [--scope <glob>] [--out <path>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Establish editorial style. Voice (`market/tone/explore`) is
how the brand sounds; editorial is what consistency looks like
in print. A team can have established voice but inconsistent
editorial — every designer writes "set up" vs "setup" their own
way; some pages have title-case headers, some have sentence-case;
product features are named differently across surfaces. For hi-fi
designs especially, editorial style is the difference between
"looks polished" and "feels professional."

This command is the orchestration layer. The output —
`product/.pencil-editorial.json` — is read by every hi-fi
generation command (pencil/templates/*, pencil/patterns/*,
marketing/email/*, etc.) to produce mechanically-consistent copy.

## What editorial covers (vs what tone covers)

| Concern                     | Where it lives                                        |
| --------------------------- | ----------------------------------------------------- |
| How the brand sounds        | `market/tone/` (voice character, dimensions)       |
| Mechanical-style rules      | `product/strategy/editorial.md` (this command)                 |
| Substantive copy            | Per-channel commands (`product/design/templates/*`, etc.)     |

If a question is about character ("warm or detached?"), it's
tone. If a question is about mechanics ("oxford comma yes or
no?"), it's editorial. They interact (a formal voice often
implies title-case headings + AP style) but they're independent
enough to deserve separate commands.

## When to use which mode

- **`--explore`** (default if no mode flag given) — fresh setup
  without a strong opinion. Generates 2-3 candidates calibrated
  to industry + brand context.
- **`--from <reference>`** — bootstrap from a named guide. Use
  when the team already has a strong editorial preference (AP
  for journalism-adjacent; Chicago for book-publishing-adjacent;
  MailChimp for SaaS-friendly; GitHub for developer tools;
  Microsoft for enterprise). Faster than --explore; produces
  identical structure.
- **`--audit`** — scan existing design files and surface the de
  facto editorial style. Use when an established codebase needs
  its implicit conventions made explicit. The audit's output
  can be accepted as the canonical .pencil-editorial.json.

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Read `product/.pencil-brand.json` for brand context (industry,
   audience, audience-regulation).
3. Read `product/.pencil-tone.json` if it exists — voice can hint
   at editorial inclinations (formality 5 voice + business-formal
   audience suggests AP or Chicago; casual SaaS voice suggests
   MailChimp's approach).
4. Resolve mode:
   - No mode flag → `--explore`
   - Multiple mode flags → error: "Pick one mode."
5. Resolve inputs:
   - `--scope <glob>` (audit mode only) — paths to scan. Default
     `design/**/*.{pen,html,txt,md}` plus generated React files
     `src/**/*.{tsx,jsx}` (string literals in JSX only — code-
     side prose linting is out of scope for this audit).
   - `--out <path>` — output path for the human-readable
     editorial-style.md. Default `design/editorial-style.md`.
     Skip generation by passing `--out none`.
   - `--dry-run` — preview without writing
     `product/.pencil-editorial.json`.
6. Check existing `.pencil-editorial.json`:
   - Doesn't exist → proceed.
   - Exists + `--explore` → confirm: "Editorial style already
     established. --explore overwrites. Continue, or did you
     mean to manually edit the JSON?"
   - Exists + `--from <ref>` → confirm: "Editorial style already
     established. --from <ref> overwrites with named guide
     defaults. Continue?"
   - Exists + `--audit` → no conflict; audit doesn't write.

## Mode 1 — `--explore`

### Phase 1 — Calibrate

Read brief + research + brand + tone (when available). Synthesize:

- **Industry baseline editorial conventions** — what category-
  typical editorial looks like. B2B ed-tech leans toward
  GitHub-flavored sentence-case + oxford comma + active voice.
  Consumer fashion leans toward title-case headlines + minimal
  punctuation flourish + brand-distinctive vocabulary. Healthcare
  leans toward AP-flavored precision + abbreviation discipline.
- **Audience expectations** — what the audience reads naturally.
  K-12 administrators read AP-style press; developers read
  GitHub-style technical writing; consumer audiences are mixed
  but skew toward MailChimp-style accessibility.
- **Brand context** — the brand's audience-regulation,
  industry, and tagline give editorial signals. A tagline like
  "Tools that respect your time" implies sentence-case +
  conversational + minimal flourish.
- **Tone alignment** — when tone is established, propose
  editorial that aligns. Voice formality 4-5 + audience
  business-formal usually wants title-case + AP-style
  abbreviation discipline; voice formality 2-3 + audience
  consumer usually wants sentence-case + active voice +
  permissive contractions.

Output a "Read of the editorial calibration" block. The user
confirms or corrects before candidates generate.

### Phase 2 — Generate candidates

Generate 2-3 candidates spanning the meaningful range. Each
candidate has:

- **Name** — short label ("Conversational", "Editorial",
  "Technical")
- **Summary** — one sentence
- **All schema fields populated** — capitalization, punctuation,
  numbers, dates, terminology shell (preferred + avoid lists
  appropriate to candidate), abbreviations, inclusion
- **Sample copy applied** — show the candidate's rules in 4-6
  contexts so the user can see the difference concretely:
  - A button label
  - A heading + subheading pair
  - A body sentence with a number, a date, and an em-dash
  - A list item
  - An error message
  - A footer line

Make candidates **meaningfully distinct**. Three candidates
clustered around (sentence-case + oxford yes + smart quotes) is
a failed exploration. A good triad spans:

```
Candidate A — "Conversational" (MailChimp-leaning)
  Capitalization:   sentence-case throughout
  Oxford comma:     yes
  Em-dash:          spaced
  Quotes:           smart
  Numbers under 10: spell out
  Date format:      "May 2, 2026"
  Terminology:      preferred forms documented; avoid list
                    excludes "click here", "submit", "world-class"
  Sample button:    "Get started"
  Sample heading:   "Get started in three minutes"
  Sample body:      "We've shipped saved searches — 3 clicks
                    to set up, saves hours per week."

Candidate B — "Editorial" (AP-leaning)
  Capitalization:   sentence-case headings, title-case key labels
  Oxford comma:     no  (AP style)
  Em-dash:          unspaced  (AP)
  Quotes:           smart
  Numbers under 10: spell out
  Date format:      "May 2, 2026"
  Sample button:    "Get Started"
  Sample heading:   "Get started in three minutes"
  Sample body:      "We've shipped saved searches—three clicks
                    to set up, saves hours per week."

Candidate C — "Technical" (GitHub-leaning)
  Capitalization:   sentence-case throughout, lowercase product
                    feature names ("saved searches" not "Saved Searches")
  Oxford comma:     yes
  Em-dash:          spaced
  Quotes:           smart
  Numbers under 10: numerals (technical writing convention)
  Date format:      "2026-05-02" (ISO; reduces ambiguity)
  Sample button:    "Get started"
  Sample heading:   "Get started in 3 minutes"
  Sample body:      "We've shipped saved searches — 3 clicks
                    to set up, saves hours per week."
```

The dimensional spread reveals what each editorial style
*does* in concrete situations — abstract editorial dimensions
("AP vs Chicago") are hard to react to; sample copy is concrete.

### Phase 3 — User picks (or hybrids)

Three accept paths:

- **Pick one** — "B" or "Editorial"
- **Hybrid** — "B's capitalization with C's number format" or
  "A but use ISO dates". Synthesize the hybrid; show resulting
  sample copy for confirmation before persisting.
- **None of these** — request another round with adjusted
  feedback ("more conservative", "less prescriptive about
  abbreviation"). Re-run Phase 2 with constraints.

### Phase 4 — Persist

Write `product/.pencil-editorial.json` per the schema in
`.product-editorial-schema.json`. Critical fields:

- `version: 1`
- `establishedAt: <ISO>`, `lastRefreshedAt: <ISO>`
- `name`: the chosen candidate's name (or hybrid name)
- `summary`: one sentence
- `inheritedFrom: null` (no named guide for explore mode)
- `deviations: []` (no documented deviations for fresh setup)
- All schema sections fully populated

When `--out` is set (default), also generate the human-readable
`design/editorial-style.md` — a one-page reference card derived
from the JSON, formatted for non-technical readers.

When `--dry-run` is set, print the JSON that would be written
and stop.

## Mode 2 — `--from <reference>`

### Phase 1 — Load named guide defaults

Recognized references (case-insensitive):

- **`ap`** — Associated Press Stylebook
- **`chicago`** — Chicago Manual of Style
- **`mailchimp`** — MailChimp Content Style Guide
- **`github`** — GitHub Style Guide / docs writing conventions
- **`microsoft`** — Microsoft Writing Style Guide
- **`custom`** — placeholder; the command asks for `--reference
  <url>` and bootstraps from a minimal base

Each named reference has a baked-in default profile that mirrors
the public guide's editorial rules.

**AP highlights**: no oxford comma; em-dash unspaced (`word—word`);
title-case for proper nouns only, sentence-case otherwise; spell
out numbers under 10; "percent" not "%"; date "May 2" or "May 2,
2026"; abbreviate state names per AP list (Calif. not CA in
running text).

**Chicago highlights**: oxford comma; em-dash unspaced; title-case
for major words in titles; spell out numbers under 100 in
narrative writing (under 10 in technical); smart quotes; date
"May 2, 2026" or "2 May 2026" depending on context.

**MailChimp highlights**: sentence-case throughout including
buttons; oxford comma; em-dash spaced (`word — word`); smart
quotes; numerals for most numbers; date "May 2, 2026"; "log in"
not "login" (verb vs noun distinction); explicit avoid list
("click here", "easy", "simply").

**GitHub highlights**: sentence-case throughout; product feature
names lowercase ("pull requests" not "Pull Requests"); oxford
comma; em-dash spaced; numerals for most numbers; ISO dates
preferred where unambiguous; technical abbreviations expected
(API, URL, SDK don't need spell-out); active voice strongly
preferred.

**Microsoft highlights**: sentence-case for UI text; Title-Case
for product names + first-level headings in marketing; oxford
comma; em-dash unspaced; smart quotes; date "May 2, 2026"; "sign
in" not "log in"; bias toward second-person ("you/your") and
active voice.

### Phase 2 — Surface deviations

After loading the named guide's defaults, ask if the team has
known deviations:

```
You're bootstrapping from MailChimp's Content Style Guide. By
default this means:

  - Sentence-case throughout (including buttons)
  - Oxford comma yes
  - Em-dash spaced
  - Smart quotes
  - "Log in" / "Set up" preferred
  - Avoid list: click here, submit, easy, simply, world-class

Any deviations from MailChimp's defaults?
  Common deviations:
    - "We use title-case for top-level headings" → log capitalization.headings = "title-case"
    - "We don't use the oxford comma" → log punctuation.oxfordComma = false
    - "Our product feature names are lowercase" → log capitalization.productFeatures = "lower-case"

Press enter to accept defaults, or describe deviations.
```

The user describes (free-form) or skips. Each deviation is
parsed into a structured change and recorded in the JSON's
`deviations` array with a rationale field for later reference.

### Phase 3 — Persist

Write `.pencil-editorial.json` with `inheritedFrom: "<reference>"`
and any `deviations` documented. Skipping deviations is fine —
most projects use the named guide's defaults verbatim.

## Mode 3 — `--audit`

### Phase 1 — Scan in-scope artifacts

Walk the configured `--scope`. For each file, extract textual
content:

- **`.pen`** files — text strings embedded in design JSON
  (use `open-pencil extract-text <file>` if available; fall
  back to heuristic JSON walk for `text` / `content` / `label`
  fields)
- **`.html`** files — text content (skip script/style blocks)
- **`.txt`** files — full content
- **`.md`** files — body text (skip frontmatter)
- **`.tsx` / `.jsx`** files — string literals inside JSX only
  (skip variable names, function names, imports, comments)

For each text artifact, accumulate counts of:

- Capitalization patterns (per element class where detectable)
- Oxford comma presence/absence in sentences with 3+ list items
- Em-dash treatment (spaced/unspaced)
- Ellipsis representation (… vs ...)
- Quote treatment (smart vs straight)
- Number formatting (under-10 spelled out vs numerals)
- Date format (ISO vs US-long vs US-short etc.)
- Terminology variants — find common words with multiple forms
  in use ("log in" / "login" / "sign in"; "set up" / "setup")
- Abbreviation patterns

### Phase 2 — Surface the de facto style

Output a report showing the dominant pattern for each editorial
dimension, plus any meaningful inconsistencies:

```
Editorial Audit — what's in use

CAPITALIZATION
  Headings:           87% sentence-case, 13% title-case
                      → Dominant: sentence-case
                      ⚠  13 files use title-case (listed below)
  Buttons:            92% sentence-case, 8% title-case
                      → Dominant: sentence-case
  Product features:   67% sentence-case, 33% title-case
                      ⚠  No clear convention — drift candidate

PUNCTUATION
  Oxford comma:       88% present in 3+ item lists
                      → Dominant: yes (oxford comma in use)
  Em-dash:            71% spaced, 29% unspaced
                      → Dominant: spaced (but inconsistent)
  Quotes:             82% smart, 18% straight
                      → Dominant: smart
                      ⚠  18% straight quotes likely paste-from-code

NUMBERS
  Under-10:           54% spelled out, 46% numerals
                      ⚠  No clear convention — drift candidate
  Currency:           "$1,234" format dominant

DATES
  Long format:        62% "May 2, 2026", 22% "2026-05-02",
                      16% "5/2/2026"
                      ⚠  No clear convention — drift candidate
  Time format:        78% 12h, 22% 24h
                      → Dominant: 12h

TERMINOLOGY (variants in use)
  ⚠  "log in" / "login" / "sign in" all in use
  ⚠  "set up" / "setup" / "configure" all in use
  ⚠  "click" / "tap" / "select" all in use (touch consideration)

ABBREVIATIONS
  e.g.:               consistently abbreviated (good)
  i.e.:               consistently abbreviated (good)
  ⚠  "Application" / "App" both in running text — pick one

INCLUSION
  Active voice:       88% (good)
  Direct address:     "you/your" used, "the user" rare (good)
  Gender-neutral:     no detected violations
```

### Phase 3 — Optionally accept the de facto style

Offer to convert the audit's findings into a canonical
`.pencil-editorial.json`:

```
Accept the dominant patterns as canonical, and document the
ambiguous areas (capitalization.productFeatures, numbers.underTen,
dates.format) as decisions that need to be made?
  [Y]es and write .pencil-editorial.json
  [n]o, just keep the report
  [r]efine the dominant patterns first (manual edit)
```

When the user accepts:

- Dominant patterns become canonical fields
- Ambiguous areas are flagged in JSON with `"resolutionNeeded":
  true` so future audit runs surface them as findings until
  resolved
- `inheritedFrom: "audit"` and the audit timestamp are recorded

## Voice ↔ Editorial alignment check

Whenever a fresh editorial style is established (any mode), run
a quick alignment check against the established tone:

- High formality voice (4-5) + sentence-case-everywhere editorial
  → flag the misalignment; high formality usually wants title-case
  for at least key labels
- Low formality voice (1-2) + AP-style strictness → flag; casual
  voice usually wants permissive editorial
- High complexity voice (4-5) + abbreviation-heavy editorial →
  reasonable alignment
- Audience-regulation k-12 + casual editorial → flag; educational
  audiences often expect more formal mechanical style

Misalignment isn't a fail; it's surface for the user to confirm
that the divergence is intentional. Some brands genuinely run
casual voice + formal mechanics (or vice versa) and it works —
but the choice should be deliberate.

## Reporting

Illustrative — adapt to the mode and outcome:

```
✓ Editorial style established: "Conversational" (MailChimp-leaning hybrid)

Source:           product/.pencil-editorial.json
Reference card:   design/editorial-style.md

Capitalization:   sentence-case throughout
                  product feature names lower-case (deviation from MailChimp)
Punctuation:      oxford comma, em-dash spaced, smart quotes
Numbers:          spell out under 10; "$1,234" format
Dates:            "May 2, 2026" long; "May 2" short; 12h time
Terminology:      4 preferred forms documented; 6 avoid words

Voice/editorial alignment: ✓ aligned
  Voice:           Confident Mentor (formality 3, warmth 4)
  Editorial:       Conversational (sentence-case + active voice)

Channels can now apply this editorial style:
  - pencil/templates/* read for hi-fi copy
  - pencil/patterns/* read for component copy
  - marketing/email/* read for inline mechanics
  - audit Plane 8 detects drift over time

Test consistency over time with /audit (Plane 8 will
scan editorial drift on each run).
```

## Idempotency

Re-running with the same mode + arguments overwrites
`.pencil-editorial.json`. Backups are kept as
`.pencil-editorial.<timestamp>.json` so reverting is cheap.

For minor changes after established editorial, hand-edit the
JSON directly. For major shifts (audience expansion, voice
change implying editorial shift), re-run with the new mode.

There is intentionally no `refine` mode (unlike tone). Editorial
is more stable than voice — once established, the right tweaks
are usually small enough to hand-edit without ceremony, and
major shifts warrant fresh exploration anyway. If teams find
themselves wanting to iteratively refine editorial often, that's
usually a signal that the original setup was wrong; re-explore.

## What this command does NOT do

- **Does not auto-fix existing artifacts.** The audit identifies
  drift; fixing is per-artifact work. The audit's `--fix` mode
  (Plane 8) generates batch find-replace operations the user can
  apply.
- **Does not enforce style on hand-edited code.** Code-side prose
  linting (variable names, comments, JSDoc) is out of scope.
  Use ESLint with prose-linting plugins, Vale, or Alex for that.
- **Does not handle multi-language editorial.** Each language
  has its own editorial conventions (English uses oxford comma;
  many European languages don't have an analog). When brand JSON
  declares `i18n.scripts` with multiple, generate per-language
  `.pencil-editorial.<locale>.json` variants manually.
- **Does not enforce inclusive-language rules at scale.** The
  inclusion section of the schema captures policy intent;
  detection beyond simple-pattern matching needs dedicated tools
  (Alex, Microsoft Inclusive Language Tool).
