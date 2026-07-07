---
description: Generate a multi-step email nurture sequence with branching logic, exit conditions, and pacing. Distinct from welcome (which is onboarding) and promotional (which is one-off) — nurture is the multi-week educational/conversion drip that moves users along a journey. Output is a coordinated set of emails plus a sequence orchestration JSON.
argument-hint: <goal> [--steps <count>] [--duration <days>] [--audience <subset>] [--branches <count>] [--informed-by <brief-slug>] [--render-only] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate a nurture sequence — a coordinated multi-step email
campaign with explicit goal, pacing, and exit conditions.
Distinct from welcome (which orients new signups in their first
days) and promotional (which is one-off): nurture is the
multi-week journey that moves users from a state to a different
state.

Common nurture goals (the `<goal>` positional argument):

- **`trial-conversion`** — guide trial users toward upgrade/buy
- **`engagement`** — re-engage users who've gone quiet
- **`reactivation`** — win back users who've fully churned
- **`education`** — long-form learning sequence (e.g. "5 days
  to better X")
- **`activation`** — convert dormant signups into active users
- **`expansion`** — guide existing users toward additional
  features/tiers
- **`other`** — freeform; the command asks what's needed

Nurture is high-stakes editorial work. The sequence's individual
emails matter less than the **arc** — does the sequence move
users toward the goal, or just take up inbox space?

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/email/_context.md`, `product/.pencil-tone.json`,
   `product/.pencil-brand.json`, `product/.pencil-marketing.json`.
2. Resolve inputs:
   - First positional: `<goal>` (per list above)
   - `--steps <count>` — number of emails in sequence. Defaults
     by goal: `trial-conversion` 5, `engagement` 3, `reactivation`
     3, `education` 5, `activation` 4, `expansion` 4. Cap at 10
     — beyond that, sequences become noise.
   - `--duration <days>` — total span. Defaults by goal:
     `trial-conversion` 14, `engagement` 21, `reactivation` 14,
     `education` 5-10 (matches step count for daily cadence),
     `activation` 21, `expansion` 30.
   - `--audience <subset>` — channel audience. Critical for
     nurture; messaging differs per audience type even within
     the same goal.
   - `--branches <count>` — branching variants. Default `1`
     (linear). Set to 2-3 for sequences that diverge based on
     user behavior (e.g. trial-conversion branches into
     "engaged" path vs "stalled" path at step 3).
   - `--informed-by <brief-slug>` — context from a brief; for
     nurture, briefs often contain the value-prop framing the
     sequence should reinforce.
   - `--render-only` — skip MJML compile.
   - `--dry-run` — preview the arc without producing files.
3. Critical: nurture sequences should reflect a **specific
   journey**. If the inputs don't make the journey clear, ask
   before generating. A trial-conversion sequence for a B2B
   enterprise tool is fundamentally different from one for a
   consumer SaaS app — same goal, different arc.

## Phase 1 — Map the arc

Before designing individual emails, sketch the user journey the
sequence should drive. Each step has a purpose in the arc.

For `trial-conversion` (5 steps over 14 days):

```
Step 1 (T+0):    Welcome to trial. Set the right expectation.
                 Goal: clarity about what trial offers, what to
                 try first.

Step 2 (T+2):    First-value moment. Surface the feature most
                 trial users find immediately useful. Goal: get
                 to first "aha" within 48 hours.

Step 3 (T+5):    Mid-trial check. Branch point: engaged users
                 get advanced-feature path; stalled users get
                 re-orientation path. Goal: differentiated
                 messaging based on observed behavior.

Step 4 (T+10):   Customer story or social proof. Address the
                 "is this really worth it" objection that hits
                 most trials around day 7-12. Goal: external
                 validation.

Step 5 (T+13):   Trial ending. Specific next steps + offer.
                 Goal: convert or graceful exit.
```

For `reactivation` (3 steps over 14 days):

```
Step 1 (T+0):    "It's been a while" — acknowledge absence
                 without being weird about it. Goal: re-establish
                 voice.

Step 2 (T+7):    "Here's what's new" — concrete reasons to
                 return (new features, customer wins, your
                 industry context). Goal: external pull.

Step 3 (T+14):   "Last try" — specific, time-bounded ask. If
                 they don't respond, sequence exits.
                 Goal: graceful close or recovery.
```

The arc shape isn't decoration — it's the strategy. Print it
clearly in the report so the user can confirm before generating
individual emails.

## Phase 2 — Define exit conditions

Nurture sequences need explicit exit conditions. Without them,
sequences keep firing into voids and erode brand trust.

Standard exits:

- **`user.unsubscribed`** — always halt
- **`user.deleted`** — always halt
- **`goal.achieved`** — halt remaining steps. The trigger event
  varies by goal:
  - trial-conversion: `subscription.created`
  - engagement: `user.session.created` (within last 7 days)
  - reactivation: `user.session.created`
  - education: `course.completed`
  - activation: `feature.first_used` (specific to product)
  - expansion: `subscription.upgraded`
- **`user.muted`** — pause sequence (resume on user un-mute)
- **`step-limit-reached`** — natural end (last step sent)

Some sequences add custom exits:

- trial-conversion: `trial.extended` (skip remaining sequence,
  rejoin at appropriate step in extension's sequence)
- engagement: `user.flagged_distress` (halt + alert team for
  human follow-up if applicable)

Exit conditions are part of the orchestration — they live in
`sequence.json`, not individual email metadata.

## Phase 3 — Generate per-email content

For each step in the arc, produce:

- Subject line (no A/B variants on nurture — predictability
  matters more than testing)
- Preheader
- Body content per the step's purpose in the arc

Voice modulation for nurture: warmth +0.5 over canonical (per
`market/email/_context.md`). Authority should match the
canonical voice — over-authoritative reads pushy in nurture
context.

For each email, follow the pattern in `market/email/welcome.md`
Phase 3 (design) but with nurture-specific structure:

```
[Logo — small, top]

[Subject reinforced as headline OR a contextual lead — depending
on arc step]

[Body content per step purpose — 100-200 words]

[Single primary CTA — clear next action for this step]

[Optional secondary content — link to depth, social proof, etc.]

[Footer — standard]
```

## Phase 4 — Branching (when --branches > 1)

For branched sequences, the branch point is a step where the
sequence diverges based on user state. After step N (the branch
point), users on different paths receive different subsequent
emails.

```
Linear (--branches 1):
  Step 1 → Step 2 → Step 3 → Step 4 → Step 5

Branched (--branches 2):
  Step 1 → Step 2 → BRANCH at end-of-step-2:
                       ├── If engaged: Step 3a → Step 4a → Step 5a
                       └── If stalled: Step 3b → Step 4b → Step 5b
```

Branch criteria are user-state predicates (clicked CTA in step
2, used feature X, opened previous email) declared in the
orchestration.

When `--branches 2-3`, generate separate `.pen` files per branch
path:

```
design/marketing/email/nurture/trial-conversion/
├── step-1.{pen,mjml,html,txt,json}
├── step-2.{pen,mjml,html,txt,json}
├── step-3-engaged.{pen,...}
├── step-3-stalled.{pen,...}
├── step-4-engaged.{pen,...}
├── step-4-stalled.{pen,...}
├── step-5-engaged.{pen,...}
├── step-5-stalled.{pen,...}
└── sequence.json
```

The sequence.json describes the branch logic.

## Phase 5 — Generate sequence.json

The orchestration file is the most important deliverable for
nurture. ESP automation engines consume it to drive the actual
sends.

```jsonc
{
  "name": "trial-conversion-nurture",
  "kind": "sequence",
  "goal": "trial-conversion",
  "audience": "trial-users",
  "trigger": {
    "type": "event",
    "event": "trial.started"
  },
  "branches": 2,
  "steps": [
    {
      "name": "step-1",
      "delay": "0m",
      "deliverable": "step-1.json",
      "purpose": "Welcome to trial. Set the right expectation."
    },
    {
      "name": "step-2",
      "delay": "2d",
      "deliverable": "step-2.json",
      "purpose": "First-value moment. Surface the feature most trial users find useful."
    },
    {
      "name": "branch-decision",
      "kind": "branch",
      "delay": "5d",
      "criteria": {
        "engaged": "user.feature.used.count >= 3 OR email.previous.clicked",
        "stalled": "default"
      }
    },
    {
      "name": "step-3-engaged",
      "delay": "0m",   // immediate after branch decision
      "deliverable": "step-3-engaged.json",
      "purpose": "Advanced-feature path. Show depth.",
      "branch": "engaged"
    },
    {
      "name": "step-3-stalled",
      "delay": "0m",
      "deliverable": "step-3-stalled.json",
      "purpose": "Re-orientation. Lower the activation bar.",
      "branch": "stalled"
    },
    // ... step-4 and step-5 per branch
    {
      "name": "step-5-engaged",
      "delay": "13d",
      "deliverable": "step-5-engaged.json",
      "purpose": "Trial ending. Specific next steps + upgrade CTA.",
      "branch": "engaged"
    },
    {
      "name": "step-5-stalled",
      "delay": "13d",
      "deliverable": "step-5-stalled.json",
      "purpose": "Trial ending. Lower-friction option, exit gracefully.",
      "branch": "stalled"
    }
  ],
  "exitConditions": [
    { "if": "user.unsubscribed",     "then": "halt" },
    { "if": "user.deleted",          "then": "halt" },
    { "if": "subscription.created",  "then": "halt" },
    { "if": "trial.extended",        "then": "rejoin", "rejoin": "extension-nurture/step-2" }
  ],
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "+0.5" }
  }
}
```

The schema is intentionally ESP-neutral. Per-ESP integrations
transform it: Customer.io has Workflows, Loops has Loops,
Resend pairs with React Email + a job runner, Klaviyo has
Flows, etc. Each consumes the canonical sequence.json and emits
its own format.

## Phase 6 — Render check across the full sequence

Before reporting completion, verify:

- Total send volume per recipient over the duration is reasonable
  (5 emails over 14 days = OK; 5 emails over 5 days = aggressive)
- Cadence has rhythm (varying delays read more natural than
  every-2-days uniform)
- Subject lines across the sequence don't repeat or collide
- Each email's primary CTA is distinct from the others (sequence
  fatigue accelerates when every email has the same ask)
- Voice consistency across the sequence is coherent (run mental
  `tone:test` on each — bigger drift across a sequence than
  within a single email)
- Branch logic is implementable (criteria reference data the ESP
  actually has)

## Reporting

```
✓ Nurture sequence generated: trial-conversion (2 branches)

Files:
  design/marketing/email/nurture/trial-conversion/
  ├── step-1.{pen,mjml,html,txt,json}
  ├── step-2.{pen,mjml,html,txt,json}
  ├── step-3-engaged.{pen,mjml,html,txt,json}
  ├── step-3-stalled.{pen,mjml,html,txt,json}
  ├── step-4-engaged.{pen,mjml,html,txt,json}
  ├── step-4-stalled.{pen,mjml,html,txt,json}
  ├── step-5-engaged.{pen,mjml,html,txt,json}
  ├── step-5-stalled.{pen,mjml,html,txt,json}
  └── sequence.json   ◀── orchestration

Goal:        trial-conversion
Steps:       5 (with 1 branch point at step 3)
Duration:    14 days
Audience:    trial-users
Voice:       Confident Mentor (warmth +0.5)

Arc:
  Step 1 (T+0):     Welcome to trial. Right expectation.
  Step 2 (T+2):     First-value moment.
  Step 3 (T+5):     Branch — engaged vs stalled.
  Step 4 (T+10):    Social proof / customer story.
  Step 5 (T+13):    Trial ending. Convert or graceful exit.

Exits:
  user.unsubscribed → halt
  user.deleted → halt
  subscription.created → halt (goal achieved)
  trial.extended → rejoin extension-nurture

Action items:
  1. Review individual emails: open each .html in browser
  2. Review the arc as a whole — does step N earn step N+1?
  3. Wire sequence.json into your ESP's automation engine
  4. Configure branch criteria with real data points your ESP has
```

## When to NOT use nurture

Some lifecycle moments call for single emails, not sequences.
Before generating, ask whether the goal is genuinely a multi-step
journey or whether a one-off email would do.

- **Goal achievable in one email**: send the one email, not 5.
- **No clear differentiated arc per step**: 5 emails saying
  similar things spaces out one ask; users notice. Compress to 2.
- **No exit on goal achievement**: if the sequence keeps firing
  after conversion, it actively damages the relationship.

`/market:email:nurture --dry-run` is your friend for sanity
checks.

## What this command does NOT do

- **Does not implement the orchestration runtime.** ESP integrations
  consume sequence.json; running the sequence is ESP work.
- **Does not handle real-time branch decisions.** Branch criteria
  are evaluated at the configured branch point; the data must be
  available to the ESP at that moment.
- **Does not auto-translate to other languages.** Per-language
  variants are manual or via translation pipeline.
- **Does not measure performance.** Open rates, click rates,
  conversion are ESP/analytics work. The audit's marketing-
  performance plane (future) might cross-reference, but
  attribution is downstream of design.
