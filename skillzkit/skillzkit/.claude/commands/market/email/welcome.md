---
description: Generate a welcome email (single send or multi-step onboarding series) triggered by user signup. Voice modulated for first-touch warmth. Produces .pen design + .mjml source + compiled .html + plain-text alternative + metadata JSON. The single most consequential email in any product's lifecycle — it sets the relationship's tone.
argument-hint: [--series <count>] [--audience <subset>] [--informed-by <brief-slug>] [--render-only] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate the welcome email (or series) for new signups. Welcome
is the single most consequential email in a product's lifecycle:
it sets the relationship's tone, frames what the user should do
first, and either propels them into the product or loses them to
inbox decay. Worth getting right.

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/email/_context.md`, and
   `product/.pencil-tone.json`.
2. Read `product/.pencil-brand.json` for visual identity (colors,
   logo, typography, domain).
3. Read `product/.pencil-marketing.json` for `channelAudience`
   subsets and any campaign coordination state.
4. Resolve inputs:
   - `--series <count>` — number of welcome emails. Default `1`
     (single welcome). Common sequences: 3 (welcome + getting
     started + first-week check-in), 5 (full onboarding drip
     over 14 days). Cap at 7 — beyond that, the sequence isn't
     "welcome" anymore, it's nurture (use `nurture.md`).
   - `--audience <subset>` — channel audience subset. Default
     `new-signups`. When the product serves multiple audiences
     (e.g. teachers + admins in K-12), generate per-audience
     variants.
   - `--informed-by <brief-slug>` — pulls feature/value-prop
     context from a brief in `design/briefs/`.
   - `--render-only` — skip MJML compilation; produce only `.pen`
     for design review. The compile step happens in a separate
     run after design approval.
   - `--dry-run` — print the plan (number of emails, subjects,
     audiences, file paths) without producing files.
5. Verify the brand JSON has the required deliverability fields
   for production use:
   - `brand.email.fromName` (display name)
   - `brand.email.fromAddress` (monitored sender)
   - `brand.email.physicalAddress` (CAN-SPAM)
   If absent, surface and ask before generating production
   metadata. Design `.pen` can be generated without these for
   review.

## Phase 1 — Determine series structure

For `--series 1`: single welcome email.

For `--series N`:

- **Step 1**: arrive (immediate, on signup) — welcome + first
  action
- **Step 2**: orient (T+1 day) — what you can do here, key
  features
- **Step 3**: first-week check (T+5-7 days) — engagement nudge,
  most-loved feature surfacing
- **Step 4**: feature spotlight (T+10 days) — depth on one
  high-value feature
- **Step 5**: feedback / community (T+14 days) — invite to
  community, ask for feedback

For 3-step: collapse to 1, 2, 5 (arrive, orient, ask).
For 5-step: full sequence.
For 7-step: add product-tour (T+3) and case-study (T+12).

The sequence's pacing is the design choice. Ask the user before
committing if the brief doesn't make pacing obvious.

## Phase 2 — Generate subject lines + preheaders

Per email in the series, generate:

- **Primary subject** — 30-50 chars, in established voice,
  context-modulated for `welcome-subject` (per
  `market/email/_context.md` modulation rules)
- **2-3 A/B variants** — meaningfully distinct (not minor
  rephrasings). Different angles: warmth-forward, action-forward,
  curiosity-forward.
- **Preheader** — 50-110 chars, extends the subject (doesn't echo
  it). Specific, not generic.

Run each subject candidate through the voice check (mental
shortcut to `tone:test --strict --context welcome-subject`). If
any candidate would fail, revise before showing.

Example for step 1 of a 3-step welcome series:

```
Step 1 subject options (welcome / arrive):
  Primary:   "Welcome — let's get you set up"
  Variant A: "You're in. Here's where to start."
  Variant B: "Welcome aboard. 3 things to do first."

Preheader: "Quick tour of your new dashboard, plus the 3 things
to set up first."
```

The user picks (or asks for more variants).

## Phase 3 — Design the email

For each email in the series, generate the `.pen` design file.
Layout follows email medium constraints from
`market/email/_context.md`:

- 600px wide, single-column primary content
- Logo top (with dark-mode variant when brand supports both)
- Body content: greeting → value/orientation → primary CTA →
  secondary content (optional) → footer
- Bullet-proof CTA button (table-based, not styled `<a>`)
- Footer: physical address, unsubscribe, preferences (when
  GDPR applies)

Voice modulation per `market/email/_context.md` welcome rules:
warmth +0.5, energy +0.5 over canonical tone.

The `.pen` file uses `product/design/foundations/colors.pen` and
`product/design/foundations/typography.pen` for tokens, ensuring brand
consistency. Specify the email-safe font fallback chain explicitly
in the design file.

```bash
# Path B (Pencil CLI):
pencil --out design/marketing/email/welcome.pen \
       --prompt "<embedded prompt: welcome email step 1, single column,
                 voice from .pencil-tone.json modulated +0.5 warmth,
                 logo top, hero greeting, body orienting copy, primary
                 CTA 'Set up your account', footer with address +
                 unsubscribe, both light + dark variants if brand
                 supports>"
```

For `--series N`, generate one `.pen` per step. Filename pattern:
`welcome.pen` (single) or `welcome/step-1.pen` (series).

## Phase 4 — Generate MJML

For each email, generate the MJML source from the `.pen` design.
MJML is the developer-facing markup that compiles to email-safe
HTML.

The MJML structure mirrors the `.pen` layout:

```xml
<mjml>
  <mj-head>
    <mj-title>{{ subject }}</mj-title>
    <mj-preview>{{ preheader }}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Inter, Helvetica, Arial, sans-serif" />
    </mj-attributes>
    <mj-style>
      @media (prefers-color-scheme: dark) {
        .body-bg { background: #1a1a1a !important; }
        .body-text { color: #f5f5f5 !important; }
      }
    </mj-style>
  </mj-head>
  <mj-body>
    <mj-section><mj-column>
      <mj-image src="{{ logo_url }}" alt="{{ brand_name }}" width="120px" />
    </mj-column></mj-section>
    <mj-section><mj-column>
      <mj-text>{{ greeting }}</mj-text>
      <mj-text>{{ body_copy }}</mj-text>
      <mj-button href="{{ cta_url }}">{{ cta_label }}</mj-button>
    </mj-column></mj-section>
    <mj-section><mj-column>
      <mj-text font-size="12px" color="#666">
        {{ physical_address }}<br/>
        <a href="{{ unsubscribe_url }}">Unsubscribe</a>
      </mj-text>
    </mj-column></mj-section>
  </mj-body>
</mjml>
```

The `{{ ... }}` placeholders are ESP-injection points. Customer.io,
Loops, Resend, etc. each have their own injection syntax —
generate the syntax that matches the project's ESP if the brand
JSON declares one (`brand.email.esp`). Default to Liquid-style
`{{ }}` which most ESPs accept or transform.

## Phase 5 — Compile to HTML

Run MJML CLI:

```bash
mjml design/marketing/email/welcome.mjml \
     -o design/marketing/email/welcome.html
```

Verify the output:

- HTML is well-formed (no parser errors)
- File size < 100KB (Gmail clips beyond 102KB)
- All images have `alt` attributes
- All links are absolute URLs (no relative paths)
- Outlook conditional comments are present where MJML generates
  them (don't strip them in any post-processing)

For series: compile each step's MJML.

## Phase 6 — Generate plain-text alternative

The `.txt` file carries the same essential information as the
HTML, formatted for plain-text rendering:

```
Welcome to Acme

Hi there,

You're all set up. To get started, head to your dashboard and
add your first project.

Set up your account: https://acme.com/getting-started

If you have questions, reply to this email — we read everything.

—The Acme Team

Acme, Inc.
123 Main Street, Suite 400
Anytown, ST 12345

Unsubscribe: https://acme.com/unsubscribe?u={{ user_id }}
```

Plain-text generation is a transform from the `.pen` (or MJML)
design — keep the same headers, same CTAs (as full URLs), same
footer. Strip styling, keep substance.

## Phase 7 — Produce metadata JSON

Per email, write the metadata JSON per the schema in
`market/email/_context.md`. Critical fields for welcome:

- `kind: "welcome"`
- `trigger.event: "user.signup.completed"` (step 1) or
  `"sequence.continue"` with delay (steps 2+)
- `audience: "new-signups"` (or per `--audience`)
- `voice.modulation: { warmth: "+0.5", energy: "+0.5" }`
- `compliance.isMarketing: false` (welcome is transactional-ish;
  no unsubscribe required for the very first welcome, though
  including one builds trust). For series steps 2+, this flips
  to `true` if the steps include marketing content.

For series: also produce `design/marketing/email/welcome/sequence.json`
describing the orchestration:

```jsonc
{
  "name": "welcome-onboarding",
  "kind": "series",
  "trigger": { "type": "event", "event": "user.signup.completed" },
  "steps": [
    { "name": "welcome-step-1", "delay": "0m",   "deliverable": "welcome/step-1.json" },
    { "name": "welcome-step-2", "delay": "1d",   "deliverable": "welcome/step-2.json" },
    { "name": "welcome-step-3", "delay": "5d",   "deliverable": "welcome/step-3.json" }
  ],
  "exitConditions": [
    { "if": "user.deleted",      "then": "halt" },
    { "if": "user.unsubscribed", "then": "halt" },
    { "if": "user.completed_onboarding", "then": "skip-remaining" }
  ]
}
```

The sequence JSON is what ESP automation engines consume to
orchestrate the drip. Each project's ESP has its own format;
this is the canonical neutral form that integrations transform.

## Phase 8 — Test rendering

Open `welcome.html` in:

- A browser (Gmail web preview)
- Litmus / Email on Acid / Mailtrap (multi-client real preview)
- An actual Outlook desktop install if available

Render check:

- Hero/CTA displays correctly at 600px desktop
- Mobile single-column stack is correct (resize to 320px)
- Dark-mode variant renders correctly when brand supports it
- Logo doesn't auto-invert ugly in dark mode
- Plain-text alternative is readable

When `--render-only` is set, skip Phase 5-8 entirely.

## Reporting

Illustrative — adapt to series count and what was produced:

```
✓ Welcome email generated

Files:
  design/marketing/email/welcome.pen
  design/marketing/email/welcome.mjml
  design/marketing/email/welcome.html  (28KB compiled)
  design/marketing/email/welcome.txt
  design/marketing/email/welcome.json

Subject:    "Welcome — let's get you set up"
Preheader:  "Quick tour of your new dashboard..."
Audience:   new-signups
Trigger:    user.signup.completed (immediate)
Voice:      Confident Mentor (warmth +0.5, energy +0.5)

Next steps:
  1. Preview design/marketing/email/welcome.html in browser
  2. Multi-client test via Litmus/EmailOnAcid before going live
  3. Run /market:tone:test against the body copy if uncertain
  4. Wire welcome.json into your ESP (Customer.io / Loops / Resend / etc.)
```

For series, the report lists all steps and the sequence.json
location.

## Idempotency

Re-running `welcome` overwrites the design files. The MJML/HTML
re-compiles deterministically (same `.pen` produces same output).
Metadata JSON is regenerated; manual additions to it are lost
on re-run — use ESP-side overrides for production-specific config
the ESP needs but the design system shouldn't track.

For series: re-running with the same `--series N` regenerates
all steps. To regenerate only a specific step, run with
`--series 1` from the appropriate step's working directory.

## What this command does NOT do

- **Does not send emails.** Sending is ESP work; this command
  produces designs and metadata that ESPs consume.
- **Does not configure ESP automation.** The sequence.json
  describes the orchestration neutrally; wiring it into
  Customer.io / Loops / Resend / etc. is integration work.
- **Does not handle dynamic content (recommended products, RAG-
  generated content).** Welcome emails are mostly static. For
  dynamic content, see `nurture.md` which has injection-point
  patterns.
- **Does not auto-translate to other languages.** When brand JSON
  declares `i18n.scripts` with multiple, generate one welcome per
  language manually (or use the team's translation pipeline).
  Voice translation is a separate concern.
- **Does not test deliverability.** Use mail-tester.com,
  Postmark's spam-checker, or your ESP's built-in tools after
  deployment.
