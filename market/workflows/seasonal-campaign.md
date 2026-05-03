---
type: workflow
description: Calendar-tied campaigns (Black Friday, year-end, back-to-school, fiscal moments, industry events). Time-boxed with strict start/peak/end windows. Higher promotional density than launch campaigns; requires sunset discipline (turn things off post-season). Coordinates email + ads + social organic + (sometimes) PR with seasonal calibration.
estimatedDuration: 3-8 weeks (asset production); time-boxed execution per the moment
phases: 10
prerequisites:
  - product/.pencil-brand.json exists
  - product/.pencil-tone.json exists
  - The seasonal moment is calendar-confirmed (date + duration locked)
  - Marketing calendar exists or seasonal moment is documented in advance (product/.pencil-marketing-calendar.json when established)
---

# Workflow — Seasonal Campaign

> **When to use**: a calendar-tied moment the team wants to
> participate in. Examples: Black Friday / Cyber Monday, year-
> end (December), back-to-school (August/September),
> tax-season, fiscal-year-end, industry conference window,
> awareness-day participation (when authentic), or company
> milestones (anniversary, fiscal calendar moments).
>
> **When NOT to use**:
> - Feature/product launch → use `launch-campaign`
> - Reactivating lapsed users → use `reactivation-campaign`
> - Brand refresh → use `brand-refresh`
> - Routine ongoing promotion → use channel commands directly

## Why seasonal is its own workflow

Seasonal differs from launch and reactivation in three ways:

1. **Time-boxed by external date.** The window is fixed (Black
   Friday is one weekend; back-to-school is August-September).
   Asset readiness must align with calendar; missed dates can't
   be made up.
2. **Promotional density is higher.** Seasonal campaigns
   typically include offers (discounts, free trials,
   bundles); the cadence is higher than non-seasonal because
   the audience expects it.
3. **Sunset matters.** Seasonal creative left running past the
   season looks dated and damages brand. The workflow includes
   explicit "turn it off" phase that other campaigns don't
   need.

## Outputs of a complete run

- Campaign brief at `design/briefs/seasonal-<season-slug>.md`
- Seasonal landing page (when warranted) — time-bounded,
  often promotional
- Seasonal email sequence (pre-season teaser + peak +
  post-season)
- Seasonal ad creative (heavy promotional emphasis)
- Social organic seasonal campaign
- PR (when warranted — usually data-led: "Our annual
  back-to-school report")
- Sunset checklist with explicit "turn off" date
- Post-season retro

## Phase 1 — Pre-flight + calendar moment confirmation

```bash
/audit
```

Then confirm the calendar moment specifics:

- **Exact date or window**: not "Black Friday" but "Friday
  November 27 - Monday November 30, all timezones"
- **Cultural / regional context**: Black Friday matters in US,
  UK, Australia; less so in many EU countries. Back-to-school
  varies by region (US Aug, UK Sep, Australia Jan). For
  global brands, document which regions participate.
- **Industry context**: tax season, fiscal year-end matter for
  finance; back-to-school for education; conference season
  for professional services. The brand's industry determines
  which moments fit.
- **Authentic fit**: a B2B SaaS for ed-tech doing back-to-
  school is authentic; a B2B SaaS for warehouse logistics
  doing back-to-school is forced. Don't run seasonal campaigns
  for moments your audience doesn't connect with.

When `product/.pencil-marketing-calendar.json` exists, the
seasonal moment should already be on the calendar (per the
calendar workflows). When it isn't, this workflow is operating
ahead of the calendar — note for next-cycle calendar planning.

**Mark complete**: `/workflows:manage complete pre-flight-moment`

## Phase 2 — Campaign brief

```bash
/product:strategy:brief seasonal-<season-slug>
```

The brief should answer:

- **What's the seasonal angle?** Why this brand, this audience,
  this moment? Generic "Happy Holidays!" campaigns
  underperform; specific angles ("Year-end pricing review for
  finance teams") work better.
- **What's the offer or hook?** Discount, free upgrade, gift
  with purchase, exclusive content, time-limited bundle, or
  no offer (pure-content seasonal campaigns work for some
  brands).
- **What's the urgency mechanic?** Real urgency (the season
  ends) is the seasonal campaign's earned right to use it.
  Don't manufacture additional urgency on top of real seasonal
  urgency — it reads as desperate. The season's natural
  countdown IS the urgency.
- **What's the call to action?** Buy, sign up, redeem, claim,
  download, etc.
- **Pre-season window**: how early to start? (2-4 weeks pre-
  peak typical)
- **Peak window**: the actual seasonal moment
- **Post-season window**: how long does the offer linger?
  (typically 1-3 days post-peak; longer dilutes)
- **Sunset date**: the absolute "turn off" date (often peak +
  3 days, sometimes peak + 7)
- **Promotional vs brand mode**: is the campaign optimizing for
  conversion (heavy promotional) or for brand association with
  the season (lighter promotional, more identity-led)?

**Mark complete**: `/workflows:manage complete campaign-brief`

## Phase 3 — Asset development — seasonal landing page

When the campaign has a specific offer or seasonal positioning,
generate a dedicated landing page:

```bash
/product:design:templates:landing-page seasonal-<season-slug>
/frameworks:heroui:build-components design/templates/landing-seasonal-<season-slug>.pen
```

Seasonal landings have specific characteristics:

- **Time-bounded explicitly** — "Offer ends Monday Dec 2" or
  countdown timer; the time-bound is a real feature, not just
  scarcity-marketing
- **Seasonal visual treatment** — colors, imagery, copy that
  ties to the moment without being kitschy. Restraint wins:
  one seasonal element done well beats six holiday-themed
  decorations.
- **Single primary CTA** — seasonal urgency means one ask;
  multi-CTA pages dilute conversion
- **Trust signals visible above fold** — security, return
  policy (when applicable), customer count or social proof —
  seasonal campaigns often reach unfamiliar visitors who need
  brand reassurance fast

For brands with permanent landing pages that get a seasonal
overlay (rather than a dedicated seasonal page), document the
overlay design in `design/templates/landing-overlay-<season>.pen`.

**Mark complete**: `/workflows:manage complete landing-page`

## Phase 4 — Seasonal email sequence

```bash
# Pre-season teaser (2-4 weeks before peak)
/market:email:promotional seasonal-<slug>-teaser \
  --campaign seasonal-<slug> --cta-style soft

# Pre-season reminder (1 week before peak)
/market:email:promotional seasonal-<slug>-reminder \
  --campaign seasonal-<slug> --cta-style direct

# Peak email (the moment) — sometimes 2-3 emails over peak window
/market:email:promotional seasonal-<slug>-peak \
  --campaign seasonal-<slug> --cta-style direct

# Last-chance email (1-2 days before sunset)
/market:email:promotional seasonal-<slug>-last-chance \
  --campaign seasonal-<slug> --cta-style urgent
# (urgent CTA is justified here — real time-bound is genuine scarcity)

# Post-season thank-you OR continuation (optional)
/market:email:promotional seasonal-<slug>-thanks \
  --campaign seasonal-<slug> --cta-style soft
```

Seasonal email sends concentrate around the peak. Frequency
caps still matter — if your brand sends a weekly newsletter
plus 4 seasonal emails in 10 days, that's 5+ emails in 10 days
to the same list. Verify total frequency stays under
unsubscribe-trigger threshold (most email infrastructure flags
3+ emails/week from same sender as fatigue risk).

For longer-window seasons (back-to-school over 6 weeks, year-
end over 4 weeks), space pre-season emails 7-14 days apart;
peak emails can be tighter (3-5 days apart).

**Mark complete**: `/workflows:manage complete email-sequence`

## Phase 5 — Seasonal ad campaigns

Seasonal ads tilt promotional. Voice modulation per
`market/ads/_context.md` performance row, plus seasonal
calibration:

```bash
# Search ads — high-intent seasonal queries
/market:ads:search seasonal-<slug>-search-google \
  --platform google --campaign seasonal-<slug> \
  --cta-style direct

# Paid social — visual-led promotional creative
/market:ads:social seasonal-<slug>-meta \
  --platform meta --placement instagram-feed \
  --campaign seasonal-<slug>

# Display when budget supports
/market:ads:display seasonal-<slug>-display \
  --campaign seasonal-<slug>

# Retargeting (warm audience reactivation during the season)
/market:ads:retargeting seasonal-<slug>-retarget \
  --audience visited --stage mid \
  --campaign seasonal-<slug>
```

Seasonal-specific considerations:

- **Bid escalation during peak** — auction prices rise during
  peak seasonal moments (everyone is bidding); plan budget
  accordingly. Heavy bidding the day before peak can be
  cheaper than peak day itself.
- **Frequency caps** — seasonal ads are tolerated at higher
  frequency than evergreen ads (the audience expects the
  push), but don't exceed 8-12 impressions/week
- **Creative rotation** — fresh creative every 5-7 days during
  peak prevents fatigue
- **Geographic / audience-segment tailoring** — back-to-school
  ads to parents differ from those to students; seasonal
  campaigns benefit from tighter audience splits than evergreen

```bash
# Audit ad↔landing message-match
/market:ads:landing audit seasonal-<slug>
```

**Mark complete**: `/workflows:manage complete ad-campaigns`

## Phase 6 — Social organic seasonal calibration

The brand's existing organic social cadence continues; seasonal
calibration overlays for the campaign window:

```bash
# Multi-platform seasonal organic via campaign coordinator
/market:social:campaign seasonal-<slug> generate \
  --platforms x,instagram,linkedin,tiktok \
  --brief "<seasonal brief>" \
  --launch-date <peak-window-start> \
  --cadence staggered
```

Seasonal organic posts blend with regular cadence — don't
abandon usual content for 100% seasonal during peak; that
makes the post-season transition jarring. Aim for 30-50%
seasonal during peak window.

For Instagram specifically, Stories during peak window are
high-leverage (24-hour ephemeral fits time-bound promotion
naturally; Stories can be added daily during peak without
flooding feed).

**Mark complete**: `/workflows:manage complete social-organic`

## Phase 7 — PR (when warranted, usually data-led)

Seasonal PR rarely takes the form of "we're running a sale"
press releases (those don't earn coverage). Seasonal PR works
as **data-led** stories tied to the moment:

- "Our 2026 back-to-school spending report" — original data
  the brand has access to, framed for journalist appeal
- "Year-end review of [industry trend]" — synthesizing the
  year for context
- "Black Friday consumer insights" — brand's analytics
  surfaced as industry analysis
- Industry-event commentary — when the season includes a
  major event the brand has perspective on

When the team has data to share:

```bash
/market:pr:press-release seasonal-<slug>-data-report \
  --type milestone --spokesperson <data-or-research-lead>
/market:pr:journalist-outreach seasonal-<slug>-data-report \
  --journalist <name> --beat <topic>
```

When there's no genuine data or insight to share, skip this
phase. Forced seasonal PR damages journalist relationships.

**Mark complete**: `/workflows:manage complete press-release`

## Phase 8 — Coordination & peak execution

Build the **seasonal runbook** at
`design/briefs/seasonal-<slug>-runbook.md`:

- **T-4 weeks**: assets production complete; audit pass; team
  alignment on seasonal angles
- **T-2 weeks**: pre-season teaser email sends; ads
  pre-positioned; social calendar updated
- **T-1 week**: pre-season reminder email; ads ramping; social
  posts scheduled for peak
- **T-0 (peak start)**: campaign activates fully
  - Hour 0: peak email sends (timezone-stagger across audience
    geography)
  - Hour 0+: ads at full bid; landing page traffic monitored
  - Hour 0+: social organic peak posts publish per platform
    schedule
- **Through peak window**: daily monitoring; creative rotation
  every 5-7 days
- **T-1 day pre-sunset**: last-chance email sends
- **T+0 sunset day**: ads paused; landing page reverts (or
  comes down); social organic returns to non-seasonal cadence
- **T+1 to T+3**: thank-you / continuation email (optional);
  retro initiated

The seasonal runbook is more rigid than launch runbook because
the calendar is rigid. Slipping pre-season by a week is fine
for a feature launch; slipping pre-season by a week for Black
Friday means pre-season ends after Black Friday begins, which
is unrecoverable.

**Mark complete**: `/workflows:manage complete coordination`

## Phase 9 — Sunset

The phase that's easy to skip and creates real damage when
skipped. After peak window ends:

- **Pause all paid ads** (search + social-paid + display +
  retargeting). Seasonal ad creative running past the season
  damages CTR and brand perception.
- **Take down or revert seasonal landing page** (or remove the
  seasonal overlay). Showing visitors a Black Friday landing
  page in February confuses and damages trust.
- **Archive seasonal social posts** (don't delete — pin off,
  let them age out of feed naturally; some platforms keep
  them in profile gallery, which is fine)
- **Restore non-seasonal ad creative** if it was paused
  during the season
- **Update the homepage** if it had seasonal overlays
- **Remove time-bound copy** from any persistent surfaces
  ("Sale ends Friday!" needs to come down once Friday passes)

Sunset checklist gets executed by the campaign coordinator
within 24-48 hours of peak window end. Document completion in
the runbook for next-season reference.

**Mark complete**: `/workflows:manage complete sunset`

## Phase 10 — Post-season retro

```bash
/product:strategy:brief seasonal-<slug>-retro
```

Capture:

- Did the campaign hit its success criteria?
- Per-channel performance (email, ads, social, PR if run)
- Comparison to last year's seasonal (when available)
- What worked surprisingly well? What underperformed?
- Calendar accuracy — did the windows land right? (Often
  pre-season was too early or too late)
- Sunset execution — did everything turn off cleanly?
- Lessons for next year's same season

Reference findings in the marketing calendar for future cycles.
Seasonal campaigns improve year-over-year more than other
campaign types because the same moment recurs predictably; the
retro feeds directly into next year's planning.

**Mark complete**: `/workflows:manage complete post-season-retro`

## What this workflow does NOT do

- **Does not handle global multi-region calendar variations**
  comprehensively. Global seasons (year-end) align across
  regions; regional seasons (US back-to-school vs UK
  September) require per-region campaigns. Run the workflow
  per-region with regional adjustments to brief and assets.
- **Does not handle inventory or fulfillment** for e-commerce
  brands. Seasonal demand surges affect logistics outside this
  workflow's scope.
- **Does not handle billing or pricing changes** beyond the
  campaign offer (subscription tier changes, permanent
  pricing updates require their own coordination).
- **Does not auto-restore non-seasonal creative**. Sunset is
  human-driven; the workflow surfaces the checklist but doesn't
  execute it automatically.
