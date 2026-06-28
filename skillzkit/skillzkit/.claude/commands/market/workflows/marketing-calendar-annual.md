---
type: workflow
outcome: Plan annual marketing calendar
description: Strategic quarter-by-quarter marketing calendar covering a 12-month horizon. Establishes themes per quarter, identifies date-driven moments (industry events, holidays, fiscal milestones), slots in major launches, sets channel cadence targets calibrated to team capacity. The annual feeds the monthly tactical workflow. Updated quarterly; rebuilt annually.
estimatedDuration: 4-8 hours interactive (best done in a single working session with stakeholders)
phases: 8
prerequisites:
  - product/.pencil-brand.json exists
  - product/.pencil-tone.json exists
  - product/.pencil-marketing.json exists OR is built during this workflow (audience subsets influence cadence per audience)
  - Marketing team capacity is honestly known (FTE count, content production capacity per week, agency support if any)
---

# Workflow — Marketing Calendar — Annual

> **When to use**: planning a 12-month marketing arc. Typically
> done at fiscal year start, calendar year start, or when the
> team's capacity / brand strategy has shifted enough that the
> previous calendar no longer reflects reality.
>
> **When NOT to use**:
> - Tactical 4-6 week scheduling → use
>   `marketing-calendar-monthly`
> - Single campaign coordination → use the appropriate
>   campaign workflow (launch / reactivation / seasonal)
> - Content calendar for a single channel → use that channel's
>   commands directly with manual scheduling

## Why annual planning matters

Marketing teams that plan campaign-by-campaign without an
annual arc consistently underperform teams with even a rough
quarterly plan. The reasons:

1. **Compounding loss**: weeks without marketing activity
   compound into lost compounding effect. A quarter with
   3 launches and 9 quiet weeks underperforms a quarter with
   2 launches and steady weekly cadence in between.
2. **Asset reuse efficiency**: planning Q3 when Q3 is starting
   means assets get produced just-in-time, expensively. Planning
   Q3 in Q1 means Q1 + Q2 work can be designed for Q3 reuse
   (same hero treatment recycled, same tone established once).
3. **Capacity calibration**: aspirational annual plans hit team
   capacity walls in Q2 when reality shows up. Honest annual
   plans calibrate cadence to actual team size from the start.
4. **Stakeholder alignment**: executive teams want to know "what
   are we doing this year?" Annual plans answer; ad-hoc
   campaigns don't.

## What "annual" means in practice

The annual calendar is **strategic, not granular**. It captures:

- **Themes per quarter** — Q1 focus, Q2 focus, etc.
- **Date-anchored moments** — fixed-date events (industry
  conferences, holidays, fiscal moments) that must coordinate
- **Major launches** — anchor moments around which other content
  orbits
- **Channel cadence targets** — what each channel commits to
  per week/month
- **Capacity assumptions** — explicit team size + production
  capacity that supports the cadence
- **Coordination rules** — when X happens, what supports it on
  other channels

The annual does **not** specify individual posts, individual
emails, individual ad creative. That's the monthly tactical
workflow's job.

## Outputs of a complete run

- `product/.pencil-marketing-calendar.json` — the canonical
  annual calendar (validated against
  `.product-calendar-schema.json`)
- `design/marketing-calendar-strategy.md` — human-readable
  reference document for stakeholders
- Quarterly review checkpoints scheduled (T+90, T+180, T+270
  for refresh)

## Phase 1 — Pre-flight

```bash
/audit
```

Then verify upstream context is established:

- Voice exists (`product/.pencil-tone.json`)
- Editorial conventions exist or accept SaaS defaults
  (`product/.pencil-editorial.json` optional)
- SEO strategy informs cadence targets when present
  (`product/.pencil-seo.json`)
- Marketing channel manifest exists or gets built during this
  workflow (`product/.pencil-marketing.json`)

When upstream pieces are missing, surface them as gaps. The
calendar can still be built without them but is less informed
— voice gaps mean cadence targets don't account for voice
production effort; SEO gaps mean the calendar can't recommend
content cluster targets.

**Mark complete**: `/core:workflows:manage complete pre-flight`

## Phase 2 — Capacity input (the honest conversation)

The single most important phase. Aspirational calendars that
ignore capacity produce burnout and inconsistent execution;
honest calendars produce sustainable cadence that compounds.

Ask explicitly:

- **Marketing team size**: how many FTEs? How many fractional?
- **Content production capacity**: how many original blog
  posts per month is realistic? (1-2 for a 1-FTE team; 4-6
  for 2-3 FTEs; 8-12 for larger teams)
- **Social posting capacity**: which platforms get attention,
  and at what cadence? (X is high-cadence, low-effort-per-post;
  TikTok is low-cadence, high-effort-per-post)
- **Email capacity**: weekly newsletter sustainable? Monthly?
  Lifecycle automation already built or needs build?
- **Ad operations capacity**: who manages bid optimization,
  creative rotation, performance reporting? In-house or agency?
- **PR capacity**: in-house PR or agency? How many press
  releases per year is realistic? Journalist relationships
  established or being built?
- **Production lead times**: how far in advance does video
  need to be planned? Designed assets? Editorial calendar?
- **Approval workflows**: who reviews what before publish? How
  long does review take?

Document the answers in the calendar manifest's
`capacityAssumptions` section. The cadence targets in later
phases must respect these — proposing weekly TikTok video for
a team without video production capacity sets the calendar up
to fail by month 2.

**Capacity ratchet**: it's better to plan for less and exceed
the plan than to plan for more and miss. Year 1 calendar should
target 70% of team's perceived capacity; the slack absorbs the
inevitable production friction.

**Mark complete**: `/core:workflows:manage complete capacity-input`

## Phase 3 — Strategic themes per quarter

Establish what the year's quarters are *about*. Themes are
broad, not granular:

- **Q1**: developer audience expansion (focus on dev-relations,
  technical content, integrations)
- **Q2**: enterprise positioning (security & compliance content,
  case studies, analyst engagement)
- **Q3**: product platform play (multi-feature launches,
  integration ecosystem, partner announcements)
- **Q4**: customer success amplification (year-end customer
  stories, ROI content, renewal-focused content)

Themes provide the through-line. Specific campaigns within a
theme inherit the theme's positioning.

For each theme, capture:

- **What the theme is**: 1-sentence focus
- **Why this theme this quarter**: business rationale
- **Audience emphasis**: which audience subset gets
  disproportionate attention
- **Channels emphasis**: which channels carry the bulk
- **Anchor moments**: launches or events that define the
  quarter's flagship content
- **Theme-end checkpoint**: what does end-of-quarter success
  look like

When themes don't naturally cohere (the team is doing many
different things), force-fitting themes is worse than acknowledging
the dispersion. In that case, document quarters as
"opportunistic" rather than themed, and the calendar focuses on
cadence consistency rather than theme amplification.

**Mark complete**: `/core:workflows:manage complete quarterly-themes`

## Phase 4 — Date-driven moments

Identify fixed-date events the calendar must coordinate around:

**Industry events** (conferences, summits, awareness days):
- Trade shows and conferences the brand attends or speaks at
- Industry awareness days/weeks (Cybersecurity Awareness Month,
  International Women's Day, Earth Day, etc.) when authentic
- Competitor major moments to defend or differentiate against

**Holidays and seasonal moments**:
- Major retail holidays (Black Friday, Cyber Monday, year-end)
  — only when the brand authentically participates
- Regional holidays for target audience (US Independence Day,
  UK Summer Bank Holiday, etc.) — affects send timing and
  cadence
- Religious holidays for global audiences — affects send
  timing (no major sends during major religious periods for
  target regions)

**Fiscal moments**:
- Brand's fiscal year-end (when financial reporting attention
  matters)
- Customer fiscal year-ends (when customer purchasing decisions
  cluster — typical for B2B with annual contracts)
- Tax season for relevant audiences
- Budget-cycle moments

**Company milestones**:
- Anniversary
- Funding round announcements (when public)
- Product anniversaries (X years since launch)
- Major customer milestones

Document each moment with:
- **Date or window**: exact dates with timezone notes for
  global audiences
- **Action**: what the brand does (silent observation,
  participate with content, full campaign)
- **Lead time required**: how far ahead asset production must
  start
- **Coordination implications**: what other channels must
  support

For windows that warrant full campaigns (Black Friday, year-end,
back-to-school), mark them for `seasonal-campaign` workflow
execution.

**Mark complete**: `/core:workflows:manage complete date-driven-moments`

## Phase 5 — Slot in major launches

Major launches are anchor moments around which the calendar
orbits. Identify which Q's quarters get major launches:

- Roadmap-confirmed launches (feature/product shipping in Q2,
  Q3, etc.)
- Speculative launches (planning-confirmed, not yet on
  roadmap)
- Reactive launch slots (capacity reserved for opportunities
  that emerge)

For each launch:

- **Launch slug** — references the eventual `launch-campaign`
  workflow
- **Estimated date or window** — quarter-precision is fine at
  annual planning level
- **Theme alignment** — which quarterly theme does this launch
  serve?
- **Channel emphasis** — typical (full coordinated launch) or
  modified (e.g. enterprise-launch with PR + analyst emphasis)
- **Capacity check**: does the launch fit the capacity
  reserved? Major launches consume 2-4 weeks of production
  capacity in the lead-up; calendar should reflect this

**Anti-pattern**: planning more than one major launch per
quarter for a small team. Major launches require focus;
parallel launches dilute both. Larger teams (5+ marketing FTEs)
can manage two launches per quarter; smaller teams should hold
to one max.

**Mark complete**: `/core:workflows:manage complete major-launches`

## Phase 6 — Channel cadence targets

Set per-channel cadence targets that match capacity. Per
channel:

- **Email**:
  - Newsletter cadence (weekly / biweekly / monthly)
  - Lifecycle email automation in scope (welcome, nurture,
    reactivation, renewal, etc.)
  - Promotional emails per quarter target
- **Blog / content**:
  - Original posts per month
  - Content cluster pages per quarter (when SEO strategy uses
    pillar+cluster)
  - Repurposing rate (long-form posts → social posts → email
    snippets)
- **Social organic per platform**:
  - X: posts per week
  - Instagram: feed posts per week, Stories cadence, Reels per
    week
  - LinkedIn: posts per week (typically lower-cadence than X)
  - Facebook: posts per week (often de-prioritized for B2B)
  - TikTok: videos per week (production-bound)
- **Paid ads**:
  - Always-on baseline campaigns (search ads typically;
    sometimes display retargeting)
  - Campaign-specific ad spend reserved per quarter
  - Budget allocation per channel
- **PR**:
  - Press releases per quarter target (typically 1-4 for a
    smaller team; major launches earn one each)
  - Journalist outreach cadence (always-on relationship
    cultivation vs campaign-specific bursts)
  - Newsroom update frequency (every release; otherwise dormant)

Document each cadence with:
- **Target**: number per period
- **Floor**: minimum below which the channel goes "dark" and
  cadence drift fires (informs Plane 10)
- **Ceiling**: maximum above which capacity strain shows
- **Owner**: who's accountable for hitting this cadence

The targets persist in `.pencil-marketing-calendar.json`'s
`channelCadenceTargets` section. Audit Plane 10 reads these to
detect drift over time.

**Mark complete**: `/core:workflows:manage complete channel-cadence`

## Phase 7 — Coordination rules

Cross-channel coordination rules that the monthly tactical
workflow honors:

- **When the newsletter ships**, what supports it on social?
  (Typically: 1-2 social posts excerpting the newsletter's
  best content, day-of and day-after.)
- **When a major launch happens**, what's the supporting
  cadence? (Per `launch-campaign` workflow — pre-launch
  emails, ad campaigns, social organic burst, PR if
  newsworthy.)
- **When a press release goes out**, what supports it?
  (Newsroom update, social drumbeat, email-list announcement
  for major releases, sales enablement.)
- **When a competitor moves**, what's the response protocol?
  (Defend / differentiate creative; sometimes silence is
  correct.)
- **When industry events happen**, what's the participation
  level? (Pre-event content, on-the-ground social, post-event
  recap.)

These rules are guidelines for the monthly tactical workflow,
not strict requirements. Document them as "default
coordination" with notes on when exceptions apply.

**Mark complete**: `/core:workflows:manage complete coordination-rules`

## Phase 8 — Persist + checkpoint schedule

Write the calendar to `product/.pencil-marketing-calendar.json`
per the schema in `.product-calendar-schema.json`. Generate the
human-readable strategy doc at
`design/marketing-calendar-strategy.md` for stakeholder
reference.

Schedule quarterly review checkpoints:

- **T+90 days** (end of Q1): review what shipped vs planned;
  update Q2-Q4 themes if Q1 changed materially
- **T+180** (end of Q2): same; the Q3 plan often gets
  meaningful updates here as the year clarifies
- **T+270** (end of Q3): Q4 planning often re-bases here as
  budget and priorities clarify
- **T+360** (end of year): annual retro + next year's planning
  workflow start

Each checkpoint is a 1-2 hour exercise: re-read the calendar,
note what's working, surface what's not, update for the
remaining quarters. The calendar is a living document.

**Mark complete**: `/core:workflows:manage complete persist-and-checkpoint`

## What this workflow does NOT do

- **Does not specify individual posts, emails, or ads.** That's
  the monthly tactical workflow.
- **Does not handle budget allocation** beyond directional
  channel emphasis. Detailed budget planning happens in
  finance tooling.
- **Does not predict performance.** The calendar is a plan, not
  a forecast.
- **Does not handle real-time crisis or opportunity response.**
  When something happens outside plan (competitor major move,
  unexpected viral moment, crisis), the calendar bends to the
  moment; document the deviation and resume.
- **Does not enforce execution.** Audit Plane 10 detects drift
  but doesn't enforce. Honest calendar + honest audit + team
  discipline produces consistent cadence.
