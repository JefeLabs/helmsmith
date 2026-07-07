---
type: workflow
outcome: Plan monthly marketing schedule
description: Tactical 4-6 week marketing schedule fed by the annual calendar. Specifies actual posts, emails, ads to produce on which dates. Calibrated to honest team capacity. Surfaces gaps and overload before the period begins. Updated weekly during execution; rebuilt every 4-6 weeks.
estimatedDuration: 1-3 hours interactive
phases: 7
prerequisites:
  - product/.pencil-marketing-calendar.json exists (annual calendar established via marketing-calendar-annual workflow)
  - product/.pencil-brand.json + product/.pencil-tone.json exist
  - Production capacity for the next 4-6 weeks is honestly known
  - Major launches or seasonal moments in the period are confirmed (date locked)
---

# Workflow — Marketing Calendar — Monthly

> **When to use**: planning the next 4-6 weeks of specific
> marketing activity. Run every 4-6 weeks during the annual
> calendar's active period.
>
> **When NOT to use**:
> - Annual strategic planning → use `marketing-calendar-annual`
> - Single campaign → use the campaign workflows (launch /
>   reactivation / seasonal)
> - Single channel scheduling → use channel commands directly

## What "monthly tactical" means

The monthly calendar specifies the actual things — concrete
posts, emails, ad creative, press releases, social campaigns —
to produce and schedule over a 4-6 week window. It reads from
the annual strategic calendar and translates themes/cadence
targets into specific calendar entries.

**Granularity**:
- Specific dates (not "Q3 sometime")
- Specific assets to produce (not "blog posts about X")
- Specific channels (not "social posts")
- Specific owners (not "marketing team")

The monthly calendar is what the team executes against. The
annual provides direction; the monthly provides the to-do.

## Outputs of a complete run

- Updated `product/.pencil-marketing-calendar.json` with
  `monthlyCalendar` section populated for the next 4-6 weeks
- Schedule document at
  `design/marketing-calendar-monthly-<YYYY-MM>.md` for the
  team to reference daily
- Generated stub assets for the upcoming period (briefs for
  campaigns about to start, draft scheduling for posts due
  in week 1)
- Coordination check report (gaps + overload surfaced)

## Phase 1 — Pre-flight + read annual calendar

```bash
/audit
```

Then read the annual calendar's relevant section:

```bash
# Read product/.pencil-marketing-calendar.json
# Identify what's expected from the annual for the next 4-6 weeks
```

Surface for review:
- **Active quarterly theme**: what's the strategic focus for
  this period?
- **Major launches scheduled**: any in the 4-6 week window?
- **Date-driven moments in window**: industry events, holidays,
  fiscal moments
- **Channel cadence targets**: what does each channel commit
  to per week?
- **Coordination rules**: cross-channel patterns to honor

This phase verifies the annual calendar still reflects
reality. If significant deviations have occurred (capacity
changed, priorities shifted, unexpected launches), update the
annual via `marketing-calendar-annual` first or note
deviations explicitly in this monthly.

**Mark complete**: `/core:workflows:manage complete pre-flight`

## Phase 2 — Capacity check for the period

Re-verify capacity for the specific 4-6 weeks:

- **Team availability**: any planned PTO, conferences,
  off-sites that reduce capacity?
- **Production lead times**: video assets needed in week 5
  must start production now; account for it
- **Approval workflow availability**: who approves what; are
  approvers available?
- **External dependencies**: agency deliverables, PR-vendor
  capacity, design contractor availability

When capacity is constrained for the period, the monthly
calendar adjusts cadence targets downward. **Don't carry
forward annual targets into a period where capacity won't
support them.** Honest reduction beats aspirational planning
that fails.

Document the period's effective capacity in the monthly
calendar's `periodCapacity` section.

**Mark complete**: `/core:workflows:manage complete period-capacity`

## Phase 3 — Slot in date-anchored events

For each date-driven moment in the window, define what happens:

- **Industry event**: pre-event social posts (week before),
  on-event live posts (during), post-event recap (week after)
- **Holiday / seasonal moment**: per `seasonal-campaign`
  workflow when full campaign warranted; otherwise observation-
  level posts
- **Company milestone**: anniversary post, milestone press
  release if newsworthy
- **Major launch in window**: schedule via `launch-campaign`
  workflow which has its own state tracking; the monthly
  calendar references the launch's runbook

Each event entry includes:
- **Date or window**: specific dates
- **Activity**: what gets produced (assets) and what gets
  published (scheduled posts)
- **Owner**: accountable person
- **Coordination**: which channels are involved
- **Lead time started**: when production work begins for the
  event

**Mark complete**: `/core:workflows:manage complete date-anchored-events`

## Phase 4 — Fill in cadence-driven content

Beyond date-anchored events, the calendar's cadence targets
require steady content. For each channel:

**Newsletter** (when applicable for the period):
- Date(s) to send
- Topic for each issue (informed by the quarterly theme)
- Production lead time backwards from send date

**Blog / content**:
- Posts to publish per cadence target (e.g. 2/week → 8 posts
  in 4 weeks)
- Topics aligned to quarterly theme + content cluster strategy
  from `.pencil-seo.json`
- Production schedule (research → draft → review → publish
  takes 1-2 weeks per post)

**Social organic per platform**:
- X: per cadence target (5 posts/week → 20-30 posts in 4
  weeks); mix of original + repurposed + community
- Instagram: feed cadence + Stories ad-hoc + Reels weekly
- LinkedIn: 3-5 posts/week, mostly text-led
- TikTok: 2-3 videos/week (production-bound)
- Facebook: at chosen cadence

For high-volume channels (X especially), don't pre-schedule
every post — leave room for real-time response, community
engagement, breaking-news commentary. Pre-schedule 60-70%;
keep 30-40% reactive.

**Paid ads**:
- Always-on campaigns continue (search, retargeting baseline)
- Campaign-specific ad activity per launch / seasonal in
  window
- Creative rotation schedule

**PR**:
- Press releases scheduled in window (each gets its own
  launch-campaign-or-equivalent prep timeline)
- Journalist relationship-building activity (analyst
  briefings, beat-reporter coffees, etc.)

The cadence-driven content fills the calendar between date-
anchored events. The mix of date-anchored + cadence-driven is
what produces compounding marketing presence.

**Mark complete**: `/core:workflows:manage complete cadence-content`

## Phase 5 — Coordination check (gaps + overload)

The monthly calendar must coordinate cross-channel activity
within the period. Run the coordination check:

**Gap detection**:
- Three+ days with no social activity on any platform = gap
- A week with no email send (when weekly cadence is target) =
  gap below floor
- Multiple consecutive weeks without blog post = gap
- Channel went silent during the period when cadence target
  said "active" = gap

**Overload detection**:
- Three+ launches in the same week = overload
- Two emails on the same day = overload (unless explicitly
  audience-segmented)
- Social posts stacking 3+ within one day on the same platform
  = overload
- More-than-cadence activity: when cadence target is "weekly
  newsletter" but the calendar has 3 newsletters in 2 weeks,
  flag

**Resolution**:
- Gaps: spread cadence-driven content into the gap
- Overload: defer, batch, or downgrade — what can move? what
  can become less ambitious?

The coordination check often surfaces real capacity issues —
the team can't actually do everything the monthly calendar
proposed. Use the surface to right-size before execution.

**Mark complete**: `/core:workflows:manage complete coordination-check`

## Phase 6 — Generate stubs for week 1

For activity in the immediate first week, generate stub assets
and scheduled drafts. Beyond week 1, the monthly calendar
documents intent without producing assets (week 4 content
gets produced when week 4 approaches — premature production
is overhead).

Examples for week 1:

```bash
# When a launch starts in week 1, run the launch campaign workflow
/core:workflows:manage start market:launch-campaign
# (This kicks off the deeper launch coordination within this monthly)

# When week 1 has a newsletter, generate the brief or draft
/market:email:newsletter newsletter-<YYYY-WW> \
  --campaign quarterly-theme-<theme>

# When week 1 has scheduled social posts, generate them
/market:social:campaign weekly-<YYYY-WW> generate \
  --platforms x,linkedin \
  --brief "<weekly theme>" \
  --launch-date <start-of-week>
```

This produces actual assets the team executes against in week
1. The remaining weeks stay at calendar-entry level until
their week approaches.

**Mark complete**: `/core:workflows:manage complete week-1-stubs`

## Phase 7 — Persist + daily reference

Write the monthly calendar section to
`product/.pencil-marketing-calendar.json`. Generate the human-
readable schedule document at
`design/marketing-calendar-monthly-<YYYY-MM>.md` for the
team's daily reference.

The schedule document is the workhorse — printed, pinned,
referenced daily. It includes:

- Week-by-week calendar view
- Per-day schedule of what's published / sent
- Per-day production work in progress
- Owners per item
- Status indicators (planned / in-production / scheduled /
  published)

The team updates the schedule document weekly during execution
(mark items shipped, surface deferrals). At end of period,
the schedule document becomes input to the next monthly's
retro.

**Mark complete**: `/core:workflows:manage complete persist`

## Daily / weekly during execution

During the 4-6 week period, the team:

- **Daily**: check the schedule for what's publishing today;
  publish; mark complete
- **Weekly**: review what shipped vs planned; adjust the next
  week's items if capacity squeezed; surface findings to next
  monthly's planning

Audit Plane 10 (cadence drift) runs at end-of-period to
formally measure cadence-target adherence. Mid-period drift
detection catches issues earlier.

```bash
# Mid-period cadence check
/audit --plane 10
```

## What this workflow does NOT do

- **Does not produce all 4-6 weeks of assets upfront.** Just-
  in-time production for non-week-1 items.
- **Does not handle real-time response** to breaking news or
  competitor moves. The calendar bends to react; document the
  deviation.
- **Does not auto-schedule to publishing platforms.** The
  schedule is human-executed via posting tools (Buffer,
  Sprout, native platform schedulers).
- **Does not measure performance.** That's analytics work.
  The schedule plans intent; analytics measures outcome.
- **Does not enforce capacity.** When the team blows past
  capacity, the schedule absorbs the strain and surfaces it
  in the next monthly's retro. Discipline lives in the team,
  not the workflow.
