---
description: Generate a recurring newsletter template — designed for repeat sends with content slots that get populated each issue. Voice fully expressed (this is the brand's recurring read). Output is a template, not a single send; per-issue content fills the slots.
argument-hint: [--frequency weekly|biweekly|monthly|quarterly] [--content-types <types>] [--audience <subset>] [--informed-by <brief-slug>] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate a newsletter template — the recurring email that lands
in subscribers' inboxes on a known cadence. Newsletters differ
from one-off marketing emails in that they're designed for
**repeat sends with rotating content** — the template is the
deliverable, populated per-issue.

The strongest newsletters have:

- **Predictable structure** — readers learn the layout and scan
  efficiently after a few issues
- **Personality** — voice fully expressed; the newsletter is
  often the closest a brand gets to its readers
- **Specific over generic content slots** — "What we shipped
  this month" beats "Updates"
- **A reason to open** — subject lines and preheaders earn the
  open every issue; coasting on subscriber loyalty erodes it

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/email/_context.md`, and `product/.pencil-tone.json`.
2. Read `product/.pencil-brand.json` for visual identity and
   `product/.pencil-marketing.json` for audience subsets and any
   existing newsletter state.
3. Resolve inputs:
   - `--frequency weekly|biweekly|monthly|quarterly` — affects
     content density (weekly is shorter; quarterly carries more).
     Default `monthly`.
   - `--content-types <comma-separated>` — what kinds of content
     slots the newsletter carries. Common values:
     `announcement`, `article`, `update`, `customer-story`,
     `tip`, `roundup`, `team-update`, `community-spotlight`,
     `industry-news`, `tutorial`. Default depends on frequency:
       - weekly: `update, tip, link-roundup`
       - biweekly: `announcement, tip, customer-story`
       - monthly: `announcement, article, customer-story, roundup`
       - quarterly: `announcement, article, customer-story,
         team-update, roundup, industry-news`
   - `--audience <subset>` — channel audience. Affects voice
     modulation if audience-specific tone variants exist.
   - `--informed-by <brief-slug>` — pulls positioning context
     from a brief.
   - `--dry-run` — preview structure without producing files.
4. Check `design/marketing/email/newsletter/` — if a newsletter
   template already exists for this audience/frequency, surface
   it. The user may want refinement (call this out and consider
   `--variant` for a parallel template) rather than overwrite.

## Phase 1 — Determine structure

Based on frequency + content types, lay out the section structure.
Each section becomes a content slot.

For monthly with default content types:

```
Sections (in order):
  1. Header           [logo + issue # + date]
  2. Editor's note    [personal opener — 50-100 words; voice forward]
  3. Announcement     [primary news of the month — 150 words + link]
  4. Article          [feature article excerpt + read-more — 100 words + link]
  5. Customer story   [short case study — 75 words + link]
  6. Roundup          [3-5 short links with one-line annotations]
  7. Footer           [physical address, unsubscribe, preferences, social]
```

For weekly with `update, tip, link-roundup`:

```
Sections (in order):
  1. Header           [logo + issue # + week-of date]
  2. Update           [what shipped / what's new — 100 words]
  3. Tip              [one tactical thing — 75 words + screenshot/example]
  4. Roundup          [5-7 short links]
  5. Footer
```

For quarterly: longer, magazine-feel, often 800-1500 words total.

The structure isn't decoration — it's a contract with readers.
After 2-3 issues, readers should know where to look for what.
Don't reshuffle without explicit reason.

## Phase 2 — Voice modulation

Newsletter voice is the most fully-expressed form of the brand
voice — no medium-specific dampening. The reader chose to
subscribe; lean into the personality.

| Dimension      | Modulation              | Notes                            |
| -------------- | ----------------------- | -------------------------------- |
| Formality      | unchanged               | Voice baseline                   |
| Warmth         | +0.5                    | Newsletters are conversational   |
| Authority      | unchanged               | Voice baseline                   |
| Energy         | unchanged               | Don't over-energize regular sends|
| Complexity     | unchanged               | Voice baseline                   |

Voice is fully present in:
- The subject line
- The preheader
- The editor's note (most personality-forward)
- Inline copy in announcements/articles/stories
- Subhead/header text

Voice is restrained in:
- Customer-quote attribution (let the customer's voice come
  through)
- External link annotations (you're framing others' work)
- Footer (functional, not emotional)

## Phase 3 — Subject + preheader

Newsletter subject conventions are the trickiest of any email
type. Generic subjects ("Newsletter — May 2026", "{{ Brand }}
Monthly") cause subscriber decay. Specific subjects pull from
the issue's content — but you don't have content yet at template
time.

**Strategy: subject template + per-issue specificity.**

Generate 3 subject patterns the team can fill per issue:

```
Pattern A (announcement-led):
  "{{ specific feature/news from this issue }}"
  Example: "Saved searches, finally"
  Example: "What we learned shipping in 30 days"

Pattern B (curiosity-led):
  "{{ specific question / hook from issue }}"
  Example: "Why 'fast' isn't a feature"
  Example: "The two metrics that actually matter"

Pattern C (roundup-led):
  "{{ N }} {{ noun }} this {{ frequency-period }}"
  Example: "5 things from May"
  Example: "What's new this week"

Avoid pattern: "{{ Brand }} Newsletter — {{ Date }}"
```

Pattern A wins on relevance; Pattern B wins on intrigue; Pattern
C is safe but dampens over time.

Preheader is similarly per-issue:

```
"{{ teaser of editor's note in 50-110 chars }}"
Example: "What I got wrong about onboarding, and what we're
trying instead."
```

Document the patterns in the metadata JSON so the team has a
reference each issue.

## Phase 4 — Design

Newsletter design tends toward magazine-feel rather than
marketing-flat. Visual conventions:

- **Top header**: logo + issue # + date (small, unobtrusive)
- **Editor's note**: distinctive treatment (background tint,
  subtle border, or larger leading) to set it apart as
  voice-forward
- **Section headers**: clear hierarchy; reader-skimmable
- **Inline imagery**: per-section featured image when applicable;
  use brand-consistent treatment (don't default to stock photos)
- **Link styling**: text links sufficient for body content;
  reserve buttons for primary CTAs only
- **Footer**: standard email footer + social links + preferences
  (granular subscription management is a strong signal of brand
  trust)

For long-form newsletters (quarterly), introduce a TOC at top:

```
In this issue:
  - Saved searches launched (and the bug that almost shipped with it)
  - The customer who saved 8 hours/week with our new export flow
  - Reads we recommend
  - What the team is working on next
```

The TOC links to anchors in the email body. Anchor links work
in modern email clients but degrade gracefully in older ones.

```bash
# Pencil generation:
pencil --out design/marketing/email/newsletter/monthly.pen \
       --prompt "<embedded prompt: monthly newsletter template, 600px,
                 voice from .pencil-tone.json fully expressed (warmth +0.5),
                 sections per Phase 1 layout, brand colors, both light + dark
                 variants, TOC at top, content slots placeholdered with
                 {{ slot_name }} syntax>"
```

## Phase 5 — MJML + compile

Generate the MJML template per `market/email/_context.md`
patterns. The MJML uses placeholder injection for each content
slot:

```xml
<mjml>
  <mj-head>
    <mj-title>{{ subject }}</mj-title>
    <mj-preview>{{ preheader }}</mj-preview>
    <!-- ... -->
  </mj-head>
  <mj-body>
    <mj-section><mj-column>
      <mj-image src="{{ logo_url }}" width="120px" />
      <mj-text font-size="11px" color="#888">
        Issue {{ issue_number }} · {{ issue_date }}
      </mj-text>
    </mj-column></mj-section>

    <mj-section><mj-column>
      <mj-text font-size="14px" font-style="italic">
        {{ editors_note }}
      </mj-text>
    </mj-column></mj-section>

    <mj-section><mj-column>
      <mj-text font-size="20px" font-weight="600">
        {{ announcement_headline }}
      </mj-text>
      <mj-text>{{ announcement_body }}</mj-text>
      <mj-button href="{{ announcement_url }}">{{ announcement_cta }}</mj-button>
    </mj-column></mj-section>

    <!-- additional content slots ... -->

    <mj-section><mj-column>
      <mj-text font-size="12px" color="#666">
        {{ physical_address }}<br/>
        <a href="{{ unsubscribe_url }}">Unsubscribe</a> ·
        <a href="{{ preferences_url }}">Preferences</a>
      </mj-text>
    </mj-column></mj-section>
  </mj-body>
</mjml>
```

Compile to HTML via standard MJML CLI invocation. The compiled
HTML keeps the placeholders intact for ESP injection.

## Phase 6 — Plain-text alternative

Newsletter plain-text follows the same section structure as the
HTML, in plain readable text. Section headers as ASCII rules
(`---` or `===`); link annotations as `[text]: URL`.

## Phase 7 — Metadata JSON

```jsonc
{
  "kind": "newsletter",
  "name": "monthly",
  "frequency": "monthly",
  "audience": "subscribers-all",
  "trigger": {
    "type": "scheduled",
    "schedule": "first-tuesday-of-month",
    "sendTime": "10:00 ET"
  },
  "subject": {
    "patterns": [
      "Pattern A (announcement-led): {{ specific news from this issue }}",
      "Pattern B (curiosity-led): {{ specific question/hook }}",
      "Pattern C (roundup-led): {{ N }} things from {{ month }}"
    ],
    "primary": null  // filled per-issue
  },
  "preheader": {
    "pattern": "{{ teaser of editor's note in 50-110 chars }}",
    "primary": null  // filled per-issue
  },
  "structure": [
    { "slot": "header",         "kind": "fixed" },
    { "slot": "editors_note",   "kind": "content", "format": "text", "wordTarget": 75 },
    { "slot": "announcement",   "kind": "content", "format": "headline+body+cta", "wordTarget": 150 },
    { "slot": "article",        "kind": "content", "format": "headline+body+cta", "wordTarget": 100 },
    { "slot": "customer_story", "kind": "content", "format": "headline+body+cta", "wordTarget": 75 },
    { "slot": "roundup",        "kind": "content", "format": "list", "itemCount": "3-5" },
    { "slot": "footer",         "kind": "fixed" }
  ],
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "warmth": "+0.5" }
  },
  "compliance": {
    "isMarketing": true,
    "regions": ["US", "EU", "CA"],
    "physicalAddress": "from .pencil-brand.json",
    "unsubscribeUrl": "{{ unsubscribe_url }}",
    "preferencesUrl": "{{ preferences_url }}"
  }
}
```

The `structure` array is the per-issue contract — content authors
fill each slot per the format spec. The `wordTarget` is a guide,
not a limit; well-written 90-word announcements beat padded
150-word ones.

## Phase 8 — Per-issue companion (optional)

When the user is ready to send their first issue, they can run:

```bash
/market:email:newsletter --issue <slug>
```

(Future enhancement, not implemented in Phase 2.) This would
generate a per-issue file populating the slots. For now, the
template is the deliverable; per-issue content authoring happens
manually or via the team's CMS.

## Reporting

```
✓ Newsletter template generated: monthly

Files:
  design/marketing/email/newsletter/monthly.pen
  design/marketing/email/newsletter/monthly.mjml
  design/marketing/email/newsletter/monthly.html  (32KB)
  design/marketing/email/newsletter/monthly.txt
  design/marketing/email/newsletter/monthly.json

Frequency:    monthly (first Tuesday)
Audience:     subscribers-all
Sections:     7 (header, editor's note, announcement, article,
              customer story, roundup, footer)
Word target:  ~500 words across content slots
Voice:        Confident Mentor (warmth +0.5)

Subject patterns documented in monthly.json (3 patterns for
per-issue selection).

Action items:
  1. Preview design/marketing/email/newsletter/monthly.html
  2. First issue: fill the slots per monthly.json's structure
  3. Wire to your ESP's recurring-send automation
```

## Idempotency

Same as other email commands. Re-running with the same `--frequency`
overwrites; use `--variant <slug>` to create a parallel template
without overwriting (e.g. `monthly` and `monthly-promo` for two
audience tracks).

## What this command does NOT do

- **Does not write per-issue content.** Templates carry slots;
  filling them is editorial work.
- **Does not handle list-segmentation logic.** ESPs handle who
  receives which issue; the template is audience-uniform within
  its declared subset.
- **Does not auto-pull product updates from a changelog or CMS.**
  Manual content authoring per issue. Future enhancement could
  integrate with changelog files.
- **Does not enforce a publishing cadence.** That's editorial
  discipline; the template's `frequency` field is documentation,
  not enforcement.
