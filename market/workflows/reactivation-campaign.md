---
type: workflow
description: Winning back lapsed users via email reactivation sequences + retargeting ads + landing pages calibrated to the lapsed audience. Lighter on press and organic social than launch campaigns; heavier on email lifecycle and retargeting frequency caps. Distinct from launch — reactivation acknowledges prior engagement and addresses why users stopped using the product.
estimatedDuration: 1-2 weeks (asset production); ongoing execution
phases: 9
prerequisites:
  - product/.pencil-brand.json exists
  - product/.pencil-tone.json exists
  - User analytics layer can identify lapsed segments (the segment definition is the campaign's foundation)
  - Email infrastructure supports reactivation campaigns (separate from regular marketing email send-list to avoid spam-flag risk)
---

# Workflow — Reactivation Campaign

> **When to use**: there's a meaningful lapsed-user segment
> the team wants to win back. The segment is defined (e.g.
> "trial users who didn't convert in the last 90 days," "paid
> users who didn't log in for 60+ days," "churned users in the
> last 12 months"). The team has capacity to support reactivated
> users (don't reactivate users you can't onboard).
>
> **When NOT to use**:
> - New feature launch → use `launch-campaign`
> - Calendar-tied promotion → use `seasonal-campaign`
> - Routine drip email to active users → use channel commands
>   directly (`/market:email:nurture`)
> - Acquiring new users (no prior relationship) → use
>   `launch-campaign` or paid ads directly

## Why reactivation is its own workflow

Reactivation differs from launch and seasonal in three ways:

1. **The audience knows the brand.** Reactivation creative
   acknowledges prior engagement; launch creative has to
   establish brand. Different voice, different copy, different
   imagery.
2. **The why-they-stopped is the message.** Launch campaigns
   sell the value proposition; reactivation campaigns address
   the obstacle (didn't see value, got busy, found alternative,
   service didn't work for their use case). Different framing.
3. **Frequency caps matter more.** Sending three reactivation
   emails to someone who left in irritation will deepen the
   irritation. Sending three retargeting impressions per week
   to someone who's "just busy" can win them back. The audience
   sub-segmentation drives cadence.

## What "reactivation" can mean

Different lapsed segments warrant different reactivation
approaches:

| Segment                                   | Approach                                                |
| ----------------------------------------- | ------------------------------------------------------- |
| Trial users who didn't convert            | "Did you get to try X?" + extension or new offer        |
| Active users who stopped logging in       | "We noticed you've been busy" + value summary           |
| Paid users who downgraded but didn't churn | Feature-specific re-engagement on the missed tier      |
| Churned users (cancelled paid)            | "What's new since you left" + return-customer offer    |
| Free users who didn't activate            | Onboarding completion nudges (overlap with welcome)    |

The Phase 2 audience definition narrows which approach applies.
Mixing segments produces watered-down creative.

## Outputs of a complete run

- Audience-segment definition at
  `design/marketing/audience-segments/<segment-slug>.json`
- Campaign brief at `design/briefs/reactivate-<slug>.md`
- Reactivation email sequence (3-5 emails)
- Retargeting ad creative (sequential — early/mid/late/burn)
- Landing page (when warranted; sometimes deep-link to product)
- Coordination + scheduling
- Post-campaign measurement & retro

## Phase 1 — Pre-flight + audience identification

Reactivation depends on the audience segment being well-defined.
Without that, the campaign is generic and underperforms.

```bash
/audit
# Catch any drift before producing reactivation assets
```

Then identify the lapsed segment specifically:

- **Definition**: who counts as lapsed? (login recency, last
  paid date, last feature use, etc.)
- **Size**: how many users in the segment?
- **Recency cohorts**: differentiate "lapsed 30 days ago" from
  "lapsed 6 months ago" — they need different messaging
- **Why they lapsed** (when known): exit survey data, support
  ticket history, in-product analytics
- **Last touchpoint**: when was the last marketing email sent?
  Reactivation often re-engages a list that's gone cold; verify
  email deliverability hasn't degraded

Document the segment in
`design/marketing/audience-segments/<segment-slug>.json`:

```jsonc
{
  "segmentSlug": "trial-stalled-q1-2026",
  "definition": "Trial users from Q1 2026 who created accounts but had < 3 logins and didn't convert",
  "size": 4200,
  "cohorts": [
    { "label": "30-60 days lapsed", "size": 1800 },
    { "label": "60-120 days lapsed", "size": 2400 }
  ],
  "knownLapseReasons": [
    "Didn't complete setup (60% of exit surveys)",
    "Found alternative tool (15%)",
    "Project/timing changed (15%)",
    "Other / unspecified (10%)"
  ]
}
```

**Mark complete**: `/workflows:manage complete pre-flight-audience`

## Phase 2 — Campaign brief

```bash
/product:strategy:brief reactivate-<segment-slug>
```

The brief should answer:

- **Which segment?** Reference the segment-definition file.
- **What's changed since they lapsed?** New features, fixed
  pain points, pricing updates — concrete reasons to come
  back. If nothing meaningful has changed, reactivation will
  underperform; consider whether to run the campaign at all.
- **What's the offer?** Some reactivation is offer-driven
  (extended trial, discount, free month); some is value-
  driven (showing what's new). Specify.
- **What's the call to action?** Reactivate, schedule demo,
  view what's new, etc.
- **Cadence ceiling**: how many touchpoints is too many for
  this segment? (Cold audiences tolerate fewer than warm
  audiences.)
- **Success criteria**: reactivation rate, login resumption,
  conversion to paid (for trial-stalled), engagement re-
  established (for active-then-quiet).

**Mark complete**: `/workflows:manage complete campaign-brief`

## Phase 3 — Email reactivation sequence

The email sequence is the workflow's core. Standard structure:

```bash
# Email 1: "We noticed you've been busy" (soft re-engagement)
/market:email:nurture reactivate-<slug>-touch-1 \
  --campaign reactivate-<slug> --tone warm-low-pressure

# Email 2: "Here's what's new since you joined" (value summary)
/market:email:nurture reactivate-<slug>-touch-2 \
  --campaign reactivate-<slug> --tone informative

# Email 3: "A specific reason to come back" (feature or offer)
/market:email:promotional reactivate-<slug>-touch-3 \
  --campaign reactivate-<slug> --cta-style direct

# Email 4 (optional, for non-responders): "Last touch from us"
/market:email:nurture reactivate-<slug>-touch-4 \
  --campaign reactivate-<slug> --tone respectful-close
```

Each email has 7-14 day spacing. The "last touch" email
acknowledges that the user may not be coming back and explicitly
offers an unsubscribe — this is **deliverability hygiene** (sending
to non-engagers degrades sender reputation; offering them an
out improves your future deliverability for engaged users).

For larger / longer-lapsed segments, consider adding a "we
heard you" email referencing exit-survey themes (when known)
— addressing the obstacle directly often reactivates users who
felt unheard.

**Mark complete**: `/workflows:manage complete email-sequence`

## Phase 4 — Retargeting ads

Retargeting is the second-highest-leverage channel for
reactivation. Sequential creative across stages:

```bash
# Early stage (1-3 days post-email-send): gentle visual reminder
/market:ads:retargeting reactivate-<slug>-retarget-early \
  --audience trial-stalled --stage early \
  --platform meta --campaign reactivate-<slug>

# Mid stage (4-7 days): more direct, feature-specific
/market:ads:retargeting reactivate-<slug>-retarget-mid \
  --audience trial-stalled --stage mid \
  --platform meta --campaign reactivate-<slug>

# Late stage (8-14 days): incentive offer
/market:ads:retargeting reactivate-<slug>-retarget-late \
  --audience trial-stalled --stage late \
  --platform meta --campaign reactivate-<slug>

# Burn stage (14-21 days): respectful close before exclusion
/market:ads:retargeting reactivate-<slug>-retarget-burn \
  --audience trial-stalled --stage burn \
  --platform meta --campaign reactivate-<slug>
```

After 21 days (or per-segment burn cycle), the audience excludes
from retargeting for a 30-90 day cooldown. Showing ads forever
to non-converters wastes budget and erodes brand.

For larger campaigns, run retargeting on multiple platforms
(Meta + Google Display + LinkedIn for B2B). Each platform's
audience composition differs; running on multiple platforms
catches users who don't engage with one platform but do
another.

**Mark complete**: `/workflows:manage complete retargeting`

## Phase 5 — Landing page (when warranted)

Reactivation campaigns sometimes need a dedicated landing page
(when the offer is specific or feature-led); other times the
landing is the existing product dashboard or a feature page
(when the campaign is value-summary-led).

**Use a dedicated landing when:**
- The offer is campaign-specific (extended trial, return-customer
  discount)
- The campaign is feature-launch-style (showcasing what's new)
- The audience needs context they didn't have before

**Skip and deep-link when:**
- Reactivation is value-summary-only and the existing product
  experience is the destination
- The login flow itself is the conversion (the goal is just to
  get them back into the product)

```bash
# When dedicated landing is warranted:
/product:design:templates:landing-page reactivate-<slug>
/frameworks:heroui:build-components design/templates/landing-reactivate-<slug>.pen

# Then audit message-match to retargeting + emails:
/market:ads:landing audit reactivate-<slug>
```

**Mark complete**: `/workflows:manage complete landing-page`

## Phase 6 — Coordination & cadence

The reactivation cadence is more delicate than launch cadence
because the audience is fragile. Build a **cadence plan** that
respects:

- **Per-user frequency cap**: total impressions per user per
  week across email + retargeting + organic touches. Target
  6-10/week max for warm audiences; under 5/week for cold or
  long-lapsed.
- **Email-then-retargeting sequencing**: emails go first, then
  retargeting kicks in 1-3 days later (the user has been
  primed by the email). Reverse sequencing (retargeting before
  email) feels surveillance-y.
- **Cohort batching**: process the segment in cohorts of 100-
  500 over a few weeks rather than blasting all 4,200 users
  on day 1. Cohort batching protects sender reputation and
  lets the team adjust based on early-cohort response.
- **Quiet hours**: respect timezone and recipient-time
  conventions (no email sends 9pm-7am recipient local time).

Document in `design/briefs/reactivate-<slug>-cadence.md`.

**Mark complete**: `/workflows:manage complete coordination-cadence`

## Phase 7 — Execution

Roll out per cadence plan:

- Day 1: Cohort 1 receives email 1; retargeting pixel for the
  cohort begins firing
- Day 4-7: Cohort 1 retargeting active; email 2 sends
- Day 14: Cohort 1 email 3; cohort 2 starts at day 1
- Continue staggering...

Monitor early-cohort response before scaling. If cohort 1's
response is below threshold, pause cohort 2 and adjust before
proceeding (the asset is broken; sending to more people just
wastes more reach).

Designate a **campaign monitor** — daily 15-minute check-in
during active execution to verify:
- Email open rates / click rates trending as expected
- Retargeting frequency caps respected (check ad-platform
  reports for cohort impressions)
- No deliverability flags from email infrastructure
- Landing page (when present) traffic flowing as expected

**Mark complete**: `/workflows:manage complete execution`

## Phase 8 — Suppression & cooldown

Critical step that's easy to skip. After the campaign window
ends:

- **Add reactivated users to onboarding flow** — they're back;
  treat them as new-to-this-feature. Don't drop them back
  into the same product experience that lost them.
- **Add non-reactivated users to suppression list** — exclude
  from this campaign type for 30-90 days minimum. Repeated
  reactivation campaigns to the same non-responsive users is
  spam-flag risk and brand-erosion risk.
- **Document the suppression rule** in segment definition for
  future reference.

```bash
# Mark non-reactivated users as suppressed
# (Implementation depends on email infrastructure; document
#  the rule in segment file)
```

**Mark complete**: `/workflows:manage complete suppression`

## Phase 9 — Post-campaign retro

```bash
/product:strategy:brief reactivate-<slug>-retro
```

Capture:

- Reactivation rate (responders / segment size)
- Per-touchpoint engagement (which email/ad worked best)
- What the team learned about why users lapsed (response to
  specific creative reveals motivations)
- Whether the offer or value-led approach won (informs future
  reactivation calibration)
- Suppression list size for future-campaign reference

The reactivation retro often surfaces **product issues** — if
60% of exit surveys cited "didn't complete setup" and the
reactivation campaign didn't move that needle, the problem is
onboarding, not marketing. Pass findings upstream to product
team.

**Mark complete**: `/workflows:manage complete post-campaign-retro`

## What this workflow does NOT do

- **Does not run a press release** — reactivation campaigns
  aren't newsworthy unless paired with a major change worth
  announcing publicly (in which case run `launch-campaign`
  alongside).
- **Does not run organic social campaigns** — reactivation is
  a private channel game (email + retargeting); broadcasting
  "we're trying to win back lapsed users" on social is
  awkward.
- **Does not handle product changes** — if reactivation
  reveals product problems, that's product team work upstream.
- **Does not handle billing or account-state changes** —
  reactivating a churned paid user requires billing work
  (re-enable account, adjust plan, etc.) outside this workflow.
