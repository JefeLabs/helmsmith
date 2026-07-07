---
description: Generate personalized pitch emails to specific journalists. Different from press release distribution — this is the relationship-driven outreach that earns coverage. Includes journalist research (publication, beat, recent coverage), pitch angle calibrated to their prior interests, embargo offer when applicable, attached or linked press release. Voice is warmer than press release prose; relationship-aware.
argument-hint: <release-slug> --journalist <name-or-slug> [--publication <name>] [--beat <topic>] [--prior-coverage <urls>] [--pitch-angle <description>] [--embargo-offered] [--informed-by <brief-slug>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash
---

Generate a personalized pitch email to a specific journalist
about a press release. Distinct from wire distribution — this
is the relationship-driven outreach that often earns the most
substantive coverage.

The pitch's job is to:

1. **Get the journalist to read the release** (most pitches die
   at the inbox, ignored)
2. **Frame why this story fits their beat** specifically
3. **Offer the embargo** when applicable
4. **Make response easy** (clear ask, contact info, attachments)

Pitches are 3-5 short paragraphs max. Long pitches signal
amateur sender; concise pitches signal respect for the
journalist's time.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/pr/_context.md`, `product/.pencil-tone.json` (the
   pitch is voiced warmer than the release; brand voice applies
   somewhat).
2. Read `product/.pencil-brand.json`.
3. Read `design/marketing/pr/boilerplate.json` for press
   contact info.
4. Read the press release: `design/marketing/pr/releases/<release-slug>.{md,json}`.
   Without an existing release, stop — pitches reference a
   specific release.
5. Resolve inputs:
   - First positional: `<release-slug>` — must match an existing
     release file
   - `--journalist <name-or-slug>` — required. The journalist
     being pitched. Slug or full name.
   - `--publication <name>` — required. Where they write.
   - `--beat <topic>` — required. Their coverage area
     (e.g. "developer tools", "AI startups", "enterprise
     software", "venture capital")
   - `--prior-coverage <urls>` — comma-separated URLs of
     articles they wrote that relate to this pitch's angle.
     The pitch references these to demonstrate relevance.
     1-3 URLs typical.
   - `--pitch-angle <description>` — the specific angle for
     this journalist. Different journalists need different
     framings of the same news. Examples for the same
     saved-searches launch:
     - For a developer-tools journalist: "agent-assisted
       workflow tooling angle"
     - For an enterprise-software journalist: "team
       productivity ROI angle"
     - For a venture-capital journalist: "category-creation
       angle" (when relevant)
   - `--embargo-offered` — flag. When set, the pitch offers
     the embargo (release embargo lift time must be set in
     the release's metadata).
   - `--informed-by <brief-slug>` — context

## Pitch structure

A pitch email follows a tight 4-paragraph structure:

```
Subject: [tight, specific, news-led; not "exciting news"]

Hi <First Name>,

[Paragraph 1: 1-2 sentences. Frame why this story matters AND
why it fits their beat specifically. References prior coverage
when natural. This earns the next 5 seconds of attention.]

[Paragraph 2: 2-3 sentences. The actual news in tight form —
what's launching/announced, key facts. Includes specific
numbers and names (concrete > abstract).]

[Paragraph 3: 1-2 sentences. The angle calibrated to their
beat. Why this specific journalist would find this specifically
interesting (not a generic "this is interesting").]

[Optional Paragraph 4: Embargo offer when applicable, OR
specific ask (interview availability, exclusive offer, demo
offer, etc.)]

Press release attached / link below. Happy to set up a call,
share screenshots, or arrange a customer for an interview.

[Sign off]
[Name]
[Title]
[Email]
[Phone]
```

The structure is genre-fixed; the *content* of each paragraph
is what makes the pitch land or fail.

## Subject line discipline

The subject line decides whether the pitch gets opened. Rules:

- **Specific over generic** — "Acme launches saved searches
  feature today, $20K avg per-team time savings" beats "Acme
  product launch news"
- **News-led** — frame as news, not announcement-of-news
- **Under 60 chars** — full visibility on most email clients
- **No tricks** — "RE:" or "FW:" when not actually replies/
  forwards damages the relationship; some clients also flag
  these as spam
- **No emojis or excessive caps** — patterns associated with
  spam
- **Embargo flagged when applicable** — "[EMBARGOED] Acme..." or
  "Embargoed for May 15: Acme launches..."

The command generates 2-3 subject line variants for the user
to choose from.

## Voice — warmer than press release, but professional

Pitch voice modulation:

- **First-person OK** — "I'm reaching out about..." beats
  "Acme is reaching out". Pitches are personal communications.
- **Brand voice applies somewhat** — within professional-pitch
  constraints. A warm-builder brand can have warmer pitches
  than a formal-financial brand; both stay business-appropriate.
- **Conversational, not casual** — written in complete sentences
  but not stiff
- **Respectful of time** — don't pad; don't include marketing
  language; don't oversell

Voice modulation table for pitches:

| Dimension | Press release | Pitch email                    |
| --------- | ------------- | ------------------------------ |
| Person    | Third-person  | First-person ("I", "we") OK    |
| Register  | Formal        | Professional but conversational|
| Length    | 400-600 words | 100-200 words                  |
| Voice flavor | Genre-locked | Brand voice within reason     |

## Phase 1 — Resolve journalist context

Three approaches, in order of preference:

1. **Existing journalist record** in
   `design/marketing/pr/journalists/<slug>.json` (when the team
   has built a registry over time):
   ```jsonc
   {
     "slug": "alice-johnson-techcrunch",
     "name": "Alice Johnson",
     "publication": "TechCrunch",
     "beat": "developer tools",
     "email": "alice.johnson@techcrunch.com",
     "priorCoverageUrls": [
       "https://techcrunch.com/2026/03/...",
       "https://techcrunch.com/2026/01/..."
     ],
     "preferences": {
       "pitchTimeOfDay": "morning ET",
       "embargoFriendly": true,
       "exclusiveSensitivity": "appreciates one-day exclusives"
     },
     "lastContacted": "2026-04-15"
   }
   ```
2. **Inline-provided context** via `--publication`, `--beat`,
   `--prior-coverage`, `--pitch-angle` flags
3. **Both** — existing record augmented with this-pitch-specific
   context

When using inline context only, suggest creating a journalist
record after the pitch generates. Building the registry over
time pays off — repeated outreach to the same journalist is
much more effective when prior-coverage references stay
accurate.

## Phase 2 — Generate the pitch

Read the release content + metadata. Apply pitch-angle to
extract the framing. Generate the pitch:

Example for the saved-searches launch pitched to a developer-
tools journalist who recently covered an AI productivity
launch:

```
Subject: Acme ships saved searches today — agent-assisted filter
         workflow following Q1 industry pattern

Hi Alice,

Saw your March piece on the agent-assisted workflow trend
(<https://techcrunch.com/2026/03/...>). Acme is shipping in
that space today and I think you'll find this one specifically
interesting because the launch addresses the "47-times-per-week"
filter-retyping pattern that customer interviews surfaced.

Acme today launched saved searches — a feature letting users
save filter combinations once and reapply with one click. Beta
testers reported saving 6-8 hours per week (n=30 teams). It's
agent-friendly: the saved filters integrate with Acme's MCP
server so AI assistants can apply them programmatically.

Given your coverage of the agent-assisted workflow trend, this
might fit a follow-up angle — or stand alone as a "what
agent-friendly product design actually looks like" piece. Happy
to connect you with a beta customer (Acme has 3 named
references willing to talk on record about the specific
hours-saved metric).

Press release attached. Available for a call this week if
useful.

Best,
Sam
Sam Smith
Press Officer, Acme
press@acme.com
+1-555-0100
```

The pitch:
- References specific prior coverage (URL inline)
- Frames the news in the journalist's beat-specific angle
  ("agent-assisted workflow trend")
- Offers a customer reference (specific, named willingness)
- Keeps the body to four paragraphs
- Closes with concrete next step

## Phase 3 — Embargo handling

When `--embargo-offered`:

- Subject line includes embargo: "[EMBARGOED]" prefix or
  "Embargoed for <date>:"
- First paragraph mentions the embargo offer explicitly
- Body references "ahead of public announcement on <date>"
- Includes the lift time/timezone unambiguously

Pitch with embargo:

```
Subject: [EMBARGOED for May 15] Acme ships saved searches —
         agent-assisted filter workflow

Hi Alice,

Reaching out with an embargoed pitch ahead of Acme's
saved-searches launch on May 15 at 9:00 AM ET. Saw your March
piece on agent-assisted workflows — this might fit a follow-up
angle.

[same body as before]

Embargo lifts May 15, 9:00 AM ET. Press release attached
(embargoed). Available for a call any time before then; happy
to coordinate with your schedule.

Best,
[etc.]
```

## Phase 4 — Compliance + voice check

- **Spam-pattern check** — subject lines and body content
  scanned for spam triggers (excessive caps, "URGENT", repeated
  punctuation, money symbols)
- **Embargo language correct** when offered (date + time +
  timezone unambiguous)
- **FTC disclosure** when this is a paid placement (rare for
  press pitches; flag if metadata indicates paid)
- **Voice check** — pitch voice in modulation range (warmer
  than release but professional); no corporate buzzword
  density

## Phase 5 — Generate metadata

```jsonc
{
  "kind": "pitch-email",
  "releaseSlug": "saved-searches-feature-launch-q2-2026",
  "journalist": {
    "slug": "alice-johnson-techcrunch",
    "name": "Alice Johnson",
    "publication": "TechCrunch",
    "beat": "developer tools"
  },
  "pitchAngle": "agent-assisted workflow trend follow-up",
  "embargoOffered": false,
  "subject": "Acme ships saved searches today — agent-assisted filter workflow following Q1 industry pattern",
  "subjectVariants": [
    "Acme ships saved searches today — agent-assisted filter workflow following Q1 industry pattern",
    "Saved searches launch — Acme's take on agent-assisted workflows",
    "Acme launches saved searches today (6-8 hours/week saved per team in beta)"
  ],
  "body": "...",
  "wordCount": 173,
  "priorCoverageReferenced": [
    "https://techcrunch.com/2026/03/..."
  ],
  "customerReferenceOffered": true,
  "fromContact": {
    "name": "Sam Smith",
    "title": "Press Officer",
    "email": "press@acme.com"
  },
  "scheduledFor": "2026-05-15T08:30:00-04:00",
  "publishMode": "manual",
  "compliance": {
    "isPaidPlacement": false,
    "embargoOffered": false
  }
}
```

## Reporting

```
✓ Pitch email generated: saved-searches-feature-launch-q2-2026 → Alice Johnson (TechCrunch)

File:    design/marketing/pr/pitches/saved-searches-feature-launch-q2-2026-alice-johnson-techcrunch.{md,json}

Subject: Acme ships saved searches today — agent-assisted filter
         workflow following Q1 industry pattern
         (selected from 3 generated variants)

Pitch angle:    agent-assisted workflow trend follow-up
Length:         173 words
Prior coverage: 1 article referenced
Customer ref:   offered

Voice:          Warmer than press release; brand voice within
                professional pitch range

Compliance:
  Embargo:              not offered
  Paid placement:       no

Action items:
  1. Review the pitch — verify the angle fits Alice's beat
     and the prior-coverage reference is accurate
  2. Pick subject line if not the default
  3. Send via your email client (the suite doesn't auto-send)
  4. Track response in journalist registry
     (consider creating design/marketing/pr/journalists/
     alice-johnson-techcrunch.json if it doesn't exist yet)
  5. Companion pitches for other journalists:
     /market:pr:journalist-outreach saved-searches-feature-launch-q2-2026 \
       --journalist <name> --publication <name> --beat <topic>
```

## Per-journalist mass outreach considerations

Press releases often go to 5-15 journalists individually. Avoid:

- **Identical pitches across journalists** — the angle must
  differ per beat. A one-size-fits-all pitch reads as mass-
  outreach (because it is) and gets ignored.
- **CC-ing multiple journalists** — never. Each pitch is its
  own personal communication.
- **Apparent template visibility** — when a journalist receives
  a pitch and another journalist receives a near-identical
  pitch, both lose trust. Variation must be substantive, not
  cosmetic.
- **High-volume blasts** — sending to 50+ journalists indicates
  weak targeting; better to send to 8-12 well-chosen journalists.

The command is run once per journalist, with deliberate
per-journalist customization.

## Idempotency

Re-running with same release-slug + journalist overwrites.
Different journalists for the same release coexist (filename
includes journalist slug).

## What this command does NOT do

- **Does not auto-send.** Submission via the team's email
  client (or CRM/PR tool when integrated). The suite produces
  the deliverable.
- **Does not maintain a journalist database.** When journalist
  records exist in `design/marketing/pr/journalists/`, the
  command reads them; database upkeep is separate work.
- **Does not measure response rates.** Earned-media tracking
  is downstream PR-tooling work.
- **Does not handle bulk import of journalist contacts.**
  Specialized PR tools (Cision, Muck Rack, MuckRack/Prowly)
  handle journalist databases; this command works with what
  the team has on hand.
- **Does not handle relationship management beyond the
  immediate pitch.** Building journalist relationships is
  long-term human work; the command supports individual
  pitches within that relationship.
