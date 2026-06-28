# Tone — Voice Context (`market/tone/`)

> Read this in addition to `product/strategy/_context.md` and
> `market/_context.md` whenever any `/market:tone:*` command
> runs.
>
> The `tone/` sub-namespace owns brand voice — the upstream that
> every marketing channel consumes. Three commands: `explore`
> (initial discovery), `test` (validate copy against established
> voice), `refine` (evolve the voice deliberately).

## What "tone" means here

Tone is **how the brand sounds**, distinct from:

- **Style** — mechanical conventions (Oxford comma, sentence-case
  vs title-case, em-dash usage). Style is documentation; tone is
  character.
- **Copy** — specific wording for specific places. Copy is the
  output; tone is the framework that produces consistent copy.
- **Brand identity** — visual + verbal totality. Tone is the
  verbal slice; brand identity also includes logos, colors,
  imagery, etc.
- **Messaging** — what we say (positioning, value props). Tone is
  how we say it. The same message can have wildly different
  tones; the same tone can deliver wildly different messages.

When in doubt: tone answers "what's the voice that connects every
piece of writing?" If the answer would change between an error
message, a marketing email, and a tweet, the tone isn't
established.

## Voice dimensions

Five dimensions, each on a 1-5 scale. Together they define a
unique voice signature:

### Formality (1 → 5)

- **1 — Streetwise**: slang, fragments, contractions everywhere.
  ("Yo, here's the deal.")
- **2 — Casual**: contractions, conversational, occasional
  fragments. ("So here's how this works.")
- **3 — Professional warm**: contractions ok, complete sentences,
  approachable vocabulary. ("Here's how this works.")
- **4 — Business formal**: minimal contractions, complete
  sentences, professional vocabulary. ("Here is how this works.")
- **5 — Legal / academic formal**: no contractions, full subordinate
  clauses, precise terminology. ("The following describes the
  operative procedure.")

### Warmth (1 → 5)

- **1 — Detached**: facts only, no acknowledgment of the reader's
  state. ("Operation complete.")
- **2 — Professional neutral**: polite, but not invested. ("Your
  request has been processed.")
- **3 — Friendly**: acknowledges the reader, offers help. ("All
  set — let me know if anything's off.")
- **4 — Warm**: invested in the reader's experience, uses second
  person actively. ("Great work — you're all set.")
- **5 — Intimate**: emotional, family-like, can risk feeling
  performative. ("So proud of you for getting this far.")

### Authority (1 → 5)

- **1 — Peer**: "I'm just like you, figuring it out together"
- **2 — Helpful guide**: "I know enough to help; you're capable"
- **3 — Knowledgeable mentor**: "I've seen this before; here's
  what works"
- **4 — Industry expert**: "this is the way; I'll explain why"
- **5 — Definitive thought leader**: "this is the answer; trust me"

### Energy (1 → 5)

- **1 — Contemplative**: patient, reflective, room to breathe
- **2 — Steady**: measured, grounded, no hurry
- **3 — Confident**: decisive, forward-moving, but not pushy
- **4 — Energetic**: enthusiastic, exclamation points natural
- **5 — Urgent**: high-pressure, "act now," "limited time"

### Complexity (1 → 5)

- **1 — Universal**: 6th-grade reading level; no jargon ever
- **2 — General adult**: 9th-grade reading level; everyday vocabulary
- **3 — Educated adult**: college-level; light domain vocabulary OK
- **4 — Industry-specialist**: domain vocabulary expected;
  defines acronyms once
- **5 — Deep technical**: assumes domain expertise; doesn't
  define terms

## Voice pillars

Beyond the dimensions, every voice carries explicit **pillars** —
short labels for what the voice IS and what it ISN'T. Five of
each:

```
We ARE: clear, supportive, direct, respectful, human
We ARE NOT: jargon-heavy, preachy, salesy, infantilizing, hedging
```

The dimensions establish the voice's coordinate space; the pillars
articulate it in plain words. When writing copy, the dimensions
guide structure and vocabulary; the pillars guide the gut check
("does this sound like us?").

## Sample contexts

When exploring or testing voice, generate sample copy in **at least
six contexts** that span the spectrum of marketing + transactional
copy:

1. **Welcome subject line** (email, marketing-leaning)
2. **Dashboard empty state** (in-product, transactional-leaning)
3. **Error message** (in-product, frustration-adjacent)
4. **Marketing landing hero copy** (marketing, brand-defining)
5. **Social media post about a feature launch** (marketing, brief,
   personality-forward)
6. **Purchase / save confirmation** (transactional, lifecycle)

Voice that works for all six is established voice. Voice that
works for one or two contexts but breaks elsewhere isn't yet
calibrated — `tone:refine` exists for this.

## Persistence — `product/.pencil-tone.json`

The canonical voice file. Read by every channel command,
audit's voice consistency check, and `tone:test`:

```jsonc
{
  "version": 1,
  "establishedAt": "2026-05-02T18:42:00Z",
  "lastRefinedAt": "2026-05-02T18:42:00Z",
  "name": "Confident Mentor",
  "summary": "Knowledgeable but accessible — speaks like a trusted advisor who respects the reader's intelligence.",
  "dimensions": {
    "formality": 3,
    "warmth": 4,
    "authority": 3,
    "energy": 3,
    "complexity": 3
  },
  "pillars": {
    "we_are":     ["clear", "supportive", "direct", "respectful", "human"],
    "we_are_not": ["jargon-heavy", "preachy", "salesy", "infantilizing", "hedging"]
  },
  "examples": {
    "welcome_subject_line":   "Welcome — let's get you set up",
    "dashboard_empty_state":  "Nothing here yet. Create your first project to start tracking progress.",
    "error_message":          "Couldn't save just now. Your work isn't lost — try again, or refresh if it keeps happening.",
    "marketing_hero":         "Tools that respect your time. Designed for people who actually do the work.",
    "social_feature_launch":  "We just shipped saved searches. Now you can find what you need in seconds, not minutes.",
    "purchase_confirmation":  "You're all set. We sent the receipt to your inbox."
  },
  "vocabulary": {
    "preferred": ["set up", "show you how", "your data", "respect your time"],
    "avoid":     ["leverage", "synergy", "in order to", "click here", "world-class", "best-in-class"]
  },
  "guidelines": [
    "Use second person (you/your) over third or first person",
    "Active voice over passive",
    "Specific over abstract",
    "Short sentences for emphasis; vary rhythm",
    "Acknowledge frustration in error messages without dwelling on it"
  ]
}
```

## When to refresh

Tone is more stable than visuals — a brand's voice should outlive
multiple visual refreshes. Reasons to refresh:

- **Audience expansion**: launching to a new audience that
  responds to a different voice (e.g. consumer brand expanding
  to enterprise; B2B brand reaching for prosumer)
- **Cultural moment**: an inflection point where the brand wants
  to recalibrate (e.g. coming out of a turnaround; new founder/
  CEO with different values)
- **Channel addition**: new channel reveals voice gaps (e.g.
  adding social makes the existing tone feel stiff for that
  medium)
- **Drift correction**: voice has drifted over time; copy across
  channels has become inconsistent. `tone:refine` re-anchors.

Don't refresh tone for minor preferences ("we want fewer
exclamation points"). That's `tone:refine` with surgical changes,
not a full re-exploration.

## Anti-patterns

- **Oscillating tone** — different voice in email vs in social vs
  in-product. Tone establishes one voice across all channels;
  modulation is medium-specific intensity, not voice change.
- **Tone doc as brand book** — voice should fit on one page of
  examples and dimensions. A 40-page brand book is a different
  artifact (for legal/agency review) and shouldn't replace the
  operational tone reference.
- **Personification too literal** — "if our brand were a person,
  they would be..." is a useful exercise but produces voice docs
  that read like character sheets. The dimensions + pillars +
  examples format is more operationally useful.
- **Voice drift via committee** — every reviewer suggesting tweaks
  produces a voice that pleases nobody. `tone:refine` exists for
  deliberate evolution; ad-hoc copy review should reference the
  established voice, not drift it.
