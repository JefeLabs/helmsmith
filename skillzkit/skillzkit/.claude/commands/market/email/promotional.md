---
description: Generate one-off promotional emails — feature launches, sales/promotions, seasonal campaigns, win-back asks. High visual energy, single clear CTA, voice fully expressed. Distinct from newsletter (recurring) and nurture (multi-step) — this is the one-shot send with an ask.
argument-hint: <type> [--variant <slug>] [--audience <subset>] [--informed-by <brief-slug>] [--cta-style soft|direct|urgent] [--render-only] [--dry-run]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate a promotional email — a one-off send with a specific
ask. Promotional emails carry the highest stakes per send: they
ask the recipient to do something now (read the launch post,
buy at the sale price, come back), and they earn or burn brand
trust based on whether the ask matches what the recipient
actually wants.

## Supported types

The `type` positional argument:

- **`launch`** — feature/product launch announcement
- **`sale`** — promotional discount or limited offer
- **`seasonal`** — themed sends tied to calendar moments
  (Black Friday, year-end, back-to-school, anniversary)
- **`winback`** — last-ditch ask to lapsed users who've already
  exited the nurture sequence
- **`event`** — webinar/conference/launch-event invite or recap
- **`announcement`** — non-launch news (acquisition, milestone,
  team change, mission update)
- **`other`** — freeform

## Pre-flight

1. Read `product/strategy/_context.md`, `market/_context.md`,
   `market/email/_context.md`, and `product/.pencil-tone.json`.
2. Read `product/.pencil-brand.json` for visual identity and
   `product/.pencil-marketing.json` for audience subsets.
3. Resolve inputs:
   - First positional: type (per list above)
   - `--variant <slug>` — variant identifier when sending
     multiple promos in the same category (e.g. `launch` with
     `--variant saved-searches` for the saved-searches feature
     launch)
   - `--audience <subset>` — channel audience. Promotional sends
     are usually tightly segmented; defaults rarely fit.
   - `--informed-by <brief-slug>` — the brief that drove this
     promo. Often a feature-launch brief or a seasonal-campaign
     brief.
   - `--cta-style soft|direct|urgent` — the CTA's intensity.
     Defaults by type: `launch` → direct; `sale` → direct;
     `seasonal` → soft (unless time-bounded); `winback` → soft;
     `event` → direct. **Never urgent without explicit user
     input** — urgency reads as desperation, and crying wolf
     erodes trust.
   - `--render-only` — skip MJML compile.
   - `--dry-run` — preview without producing files.
4. Critical: confirm the audience has been informed of related
   things recently. Sending a launch email to a list that just
   got 3 nurture emails risks fatigue. Surface recent send
   activity from `.pencil-marketing.json` (when populated) and
   ask the user to confirm the audience can absorb this send.

## Phase 1 — Type-specific framing

Each type has different conventions:

### `launch`
- Lead with the feature, not the company
- Subject specifies what's new in concrete terms
- Body: what it does + why now + how to try it
- CTA: "Try it" or "See what's new" — direct, action-oriented
- Visual: feature screenshot or animated product shot is high-leverage
- Avoid: hype words ("revolutionary", "game-changing"), excessive
  exclamation, vague subjects

### `sale`
- Lead with the offer specifics — discount %, timeframe, what's
  included
- Subject specifies the offer
- Body: what's discounted + how much off + when the offer ends
  + clear redemption path
- CTA: "Save now", "Use code [XXXX]" — direct
- Visual: clean offer-forward; avoid casino aesthetic
- Compliance: include all material terms (final price, expiry,
  conditions); don't bury

### `seasonal`
- Connect to the season meaningfully, not just thematically
  ("Year-end is when teams plan for next year — here's how we
  can help" beats "Happy holidays, here's a discount")
- Subject can lean into the moment but still earn the open
- Body: tie the brand's value to the seasonal context
- CTA varies by intent (could be content, could be offer)
- Visual: seasonal touches without abandoning brand identity
- Avoid: generic seasonal greetings without product context

### `winback`
- Acknowledge the absence without apologizing for it
- Subject is honest: "We miss you" works only if it's actually
  earned; usually better to lead with what's changed
- Body: short. Specific reason to come back. Single clear path
  back.
- CTA: "Take another look" or specific feature CTA — soft
- Visual: restrained; this is an attempt at reconnection, not
  a pitch
- Compliance: respect the unsubscribe trajectory. If user has
  ignored prior winbacks, this may be the last attempt before
  list removal.

### `event`
- Subject specifies what + when (or recap + what was in it)
- Body: agenda, speakers, value, how to attend
- CTA: "Register" or "Save your seat" — direct
- Visual: speaker faces, venue, or an event hero graphic
- Compliance: registration data handling per GDPR if EU
  attendees; webinar follow-up promos are subject to consent
  separately

### `announcement`
- Lead with the news plainly
- Subject is the headline ("We've raised our Series B" or "Acme
  is joining XYZ")
- Body: what changed, what it means for users, what changes (if
  anything) in product/pricing/data
- CTA: "Read the post" or "Learn what changes" — direct, often
  links to a blog post
- Visual: founder photo, team photo, milestone image
- Voice: warmth elevated; this is a brand moment. Avoid
  corporate-PR voice.

## Phase 2 — Voice modulation

Promotional voice has moderate dampening from canonical baseline:

| Type           | Warmth   | Authority  | Energy   | Notes                                  |
| -------------- | -------- | ---------- | -------- | -------------------------------------- |
| launch         | unchanged| unchanged  | +0.5     | Excited but not over-the-top           |
| sale           | unchanged| unchanged  | +0.5     | Energetic but not desperate            |
| seasonal       | +0.5     | unchanged  | unchanged| Warmth carries the moment              |
| winback        | +0.5     | -0.5       | -0.5     | Soft, humble, no pressure              |
| event          | unchanged| +0.5       | +0.5     | Authoritative re: value, energetic re: timing |
| announcement   | +0.5     | unchanged  | unchanged| Warm but composed                      |

**The `--cta-style urgent` modulation is the exception** — if
explicitly chosen, energy lifts to +1.0 and the language tilts
toward immediacy ("Tomorrow at 10 ET", "24 hours left"). Use
sparingly. Genuine urgency (sale-ends-tonight, registration-
closes-today) earns it; manufactured urgency erodes trust.

## Phase 3 — Subject + preheader

For promotional, generate:

- **Primary subject** — 30-50 chars, in voice, type-appropriate
  framing
- **2-3 A/B variants** — different angles. For `launch`:
  feature-forward, benefit-forward, curiosity-forward. For
  `sale`: offer-specific, urgency-bracketed (when applicable),
  outcome-focused. For `winback`: warm, news-led, ask-forward.
- **Preheader** — 50-110 chars, extends subject

Examples:

```
launch (saved searches feature):
  Primary:   "Saved searches, finally"
  Variant A: "Stop re-typing the same searches"
  Variant B: "We just shipped saved searches"
  Preheader: "Your filters, named and reusable. Two clicks to
  set up; saves hours per week."

sale (annual plan promo, 25% off):
  Primary:   "Save 25% on annual plans through Friday"
  Variant A: "Annual plans, 25% off — ends Friday"
  Variant B: "Three days left: 25% off the year"
  Preheader: "Lock in your team's plan for the year — same
  features, $400 less. Code ANNUAL25 at checkout."

winback (lapsed-user winback):
  Primary:   "What's changed since you've been gone"
  Variant A: "We miss you (and we shipped some good stuff)"
  Variant B: "Quick check-in — five things since you last looked"
  Preheader: "Saved searches, exports, the new dashboard. Worth
  another look?"
```

The user picks a primary; variants are A/B-test fodder for the
ESP.

## Phase 4 — Design

Promotional layout is medium-energy:

- **Top header**: logo (smaller than newsletter; sometimes
  omitted entirely on launches when the feature is the lead)
- **Hero**: feature screenshot, animated product shot,
  illustration, or strong typography depending on type
- **Body**: tight — 75-150 words for most types; less for
  winback (50-75)
- **Single primary CTA**: bullet-proof button per
  `market/email/_context.md`. Color and prominence reflect
  the canonical accent color from brand JSON.
- **Secondary content (optional)**: customer quote, supporting
  link, related feature
- **Footer**: standard

For launches especially, consider an animated GIF of the feature
in action — but be aware:
- Animated GIFs work in most clients; Outlook Windows usually
  shows only the first frame (so the first frame must be
  meaningful)
- File size matters; keep under 1MB to avoid clipping
- Provide a static fallback as the first frame

```bash
pencil --out design/marketing/email/promo/launch-saved-searches.pen \
       --prompt "<embedded prompt: launch promo email, single column 600px,
                 voice from .pencil-tone.json energy +0.5, hero with feature
                 screenshot, body 100 words explaining what + why + how to try,
                 primary CTA 'Try saved searches' in brand accent color,
                 footer standard>"
```

## Phase 5 — MJML, HTML, plain-text

Standard pipeline per `market/email/_context.md`. Two
specifics for promotional:

- **The CTA gets visual weight** — bullet-proof button with
  brand accent color, padding 12-16px vertical / 24-32px
  horizontal, border-radius matching brand radius scale, sized
  to thumb-tap-friendly on mobile (minimum 44×44px tap target)
- **Compliance footer is non-negotiable** — physical address,
  unsubscribe (CAN-SPAM + GDPR), preferences when applicable.
  Minimum readable size; gray text 11-12px on light is the
  conventional minimum.

Plain-text alternative carries the same offer specifics.
Especially important for `sale` — power users who use
plain-text rendering should get the same offer detail (discount
%, code, expiry).

## Phase 6 — Metadata JSON

```jsonc
{
  "kind": "promotional",
  "subType": "launch",                  // launch | sale | seasonal | winback | event | announcement | other
  "name": "launch-saved-searches",
  "audience": "active-users",
  "trigger": {
    "type": "manual",                   // most promos are manual sends, not event-triggered
    "scheduledFor": null                // can be filled with ISO datetime if pre-scheduled
  },
  "subject": {
    "primary": "Saved searches, finally",
    "variants": [
      "Stop re-typing the same searches",
      "We just shipped saved searches"
    ]
  },
  "preheader": "Your filters, named and reusable. Two clicks to set up; saves hours per week.",
  "cta": {
    "primary": {
      "label": "Try saved searches",
      "url": "https://acme.com/dashboard?utm_source=email&utm_campaign=launch-saved-searches",
      "style": "direct"
    }
  },
  "voice": {
    "tone": "product/.pencil-tone.json",
    "modulation": { "energy": "+0.5" }
  },
  "compliance": {
    "isMarketing": true,
    "regions": ["US", "EU", "CA"],
    "physicalAddress": "from .pencil-brand.json",
    "unsubscribeUrl": "{{ unsubscribe_url }}",
    "preferencesUrl": "{{ preferences_url }}",
    "requiresMaterialTermsDisclosure": false   // true for sales — final price, expiry, conditions all in body
  }
}
```

For `sale` type: `compliance.requiresMaterialTermsDisclosure` is
`true`, and the body is verified to include all material terms
(actual price after discount, expiry date, redemption code,
applicable products). Burying or omitting these is a CAN-SPAM
risk.

## Phase 7 — Send-readiness check

Before reporting complete, verify:

- All link URLs include UTM parameters (utm_source, utm_medium,
  utm_campaign at minimum) so attribution downstream works
- The audience subset has the right size for the send (very
  small audience may not warrant a promo; very large
  unsegmented audience may need filtering)
- The send doesn't conflict with another promo recently or
  imminently scheduled (cross-reference
  `.pencil-marketing.json` schedule)
- The CTA URL resolves (sanity check — broken CTA on a launch
  is the worst-case scenario)
- Voice consistency check (mental `tone:test`) on subject,
  body, CTA label

## Reporting

```
✓ Promotional email generated: launch / saved-searches

Files:
  design/marketing/email/promo/launch-saved-searches.pen
  design/marketing/email/promo/launch-saved-searches.mjml
  design/marketing/email/promo/launch-saved-searches.html  (38KB)
  design/marketing/email/promo/launch-saved-searches.txt
  design/marketing/email/promo/launch-saved-searches.json

Subject:    "Saved searches, finally"  (+ 2 A/B variants)
Preheader:  "Your filters, named and reusable..."
Audience:   active-users
Trigger:    manual (schedule via ESP)
CTA:        "Try saved searches" → /dashboard (direct style)
Voice:      Confident Mentor (energy +0.5)

Compliance:
  CAN-SPAM unsubscribe:    yes
  Physical address footer: yes (from brand JSON)
  Material terms (sale):   N/A (launch type)

Action items:
  1. Preview design/marketing/email/promo/launch-saved-searches.html
  2. Verify CTA URL resolves and tracks UTM params
  3. Run /market:tone:test on body copy (high-stakes copy)
  4. Schedule send via ESP; consider tight audience filter
     (active-users in last 30 days)
  5. Plan companion social posts via /market:social:* (when
     namespace is built)
```

## Idempotency

Re-running with the same `<type>` and `--variant` overwrites.
For one-off promos, this is usually fine — but if the email has
been sent, archive the version that went out before regenerating.
A common pattern is to append the date to `--variant` for
sent promos: `--variant saved-searches-2026-05-02` after send.

## When to NOT send a promotional email

Some "good ideas" don't earn a send:

- **Audience just received another promo** — fatigue is real;
  back-to-back promos hurt
- **Audience is in the middle of a nurture sequence** —
  interrupting a journey with a promo dilutes both
- **The "promo" is just a recap** — that belongs in the
  newsletter, not a separate send
- **The CTA isn't clear** — if you can't write the CTA in 3 words,
  the promo isn't ready

`--dry-run` surfaces these. Use it.

## What this command does NOT do

- **Does not segment the audience.** Audience targeting is ESP
  work; the email's `audience` field declares intent but the
  ESP's segmentation rules drive actual recipient list.
- **Does not optimize subject line A/B at runtime.** Variants
  are documented for ESP testing; the ESP picks the winner per
  its own rules.
- **Does not handle in-app companion notifications.** Multi-
  channel launch coordination (email + in-app banner + push)
  belongs in a future `market/workflows/*` command.
- **Does not check that the feature being launched actually
  exists.** Launching vaporware is a worse problem than this
  command can catch.
