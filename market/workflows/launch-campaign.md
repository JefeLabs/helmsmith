---
type: workflow
description: Coordinated feature or product launch across email, ads, social organic, PR, and landing pages. The cross-channel orchestrator that turns "we shipped X" into a multi-channel announcement with appropriate cadence on each surface. Press release optional based on newsworthiness threshold.
estimatedDuration: 1-3 weeks (asset production); 1-2 days execution
phases: 11
prerequisites:
  - product/.pencil-brand.json exists (brand is defined)
  - product/.pencil-tone.json exists (voice established via /market:tone:explore)
  - product/.pencil-editorial.json exists or accept defaults (via /product:strategy:editorial)
  - The feature/product being launched is shipped or imminent (asset coordination misfires when launch dates slip)
---

# Workflow — Launch Campaign

> **When to use**: a feature or product launch that warrants
> coordinated marketing across multiple channels. The launch is
> meaningful enough that disconnected channel-by-channel work
> would underperform a coordinated push.
>
> **When NOT to use**:
> - Routine feature shipping (no marketing required) — just
>   ship + update changelog
> - Reactivating lapsed users → use `reactivation-campaign`
> - Calendar-tied promotions (Black Friday, year-end) → use
>   `seasonal-campaign`
> - Brand refresh / visual identity update → use `brand-refresh`

## What "warrants" a launch campaign

Not every shipped feature needs this workflow. Use it when:

- The feature is a **headline capability** — net-new product
  area, major workflow, significant differentiator
- It targets a **specific audience** the team wants to reach at
  scale (current customers, prospects, both)
- The team has **capacity** for asset production over 1-3 weeks
- There's **clear measurement intent** — what counts as
  campaign success (sign-ups, feature adoption, press coverage,
  brand mentions, etc.)

When unsure, run a smaller-scope path: just an email
announcement + social post via the channel commands directly
(no workflow). The workflow is for genuine coordinated launches.

## Outputs of a complete run

- Campaign brief at `design/briefs/<campaign-slug>.md`
- Landing page at `design/templates/landing-<slug>.pen` +
  rendered React
- SEO strategy update (if feature shifts keyword targets)
- Email sequence: pre-launch announcement + launch-day
  email + post-launch follow-up (3-5 emails minimum)
- Ad creative across selected formats (search + social-paid +
  retargeting typical; display + video when budget warrants)
- Social organic campaign across selected platforms
- Press release + media kit + journalist pitches (when
  newsworthy)
- Newsroom page update (when press release ships)
- Coordinated launch-day schedule across all channels
- Post-launch retro at `design/briefs/<campaign-slug>-retro.md`

## Phase 1 — Pre-flight audit

Run audit before producing assets. Drift in voice, editorial,
SEO, foundations, components, or templates means launch assets
inherit that drift.

```bash
/audit
```

Address fail-severity findings before proceeding. Warnings can
be deferred but document which were noted.

**Critical for launch campaigns**: verify foundation work is
done. Generating a launch landing page with stale foundations
produces visually-inconsistent results that cascade into all
downstream channel assets (which derive from the landing's
hero treatment, color choices, copy approach).

**Mark complete**: `/workflows:manage complete pre-flight-audit`

## Phase 2 — Campaign brief

Capture the launch's intent in a brief. The brief informs every
downstream channel; vague briefs produce vague campaigns.

```bash
/product:strategy:brief launch-<slug>
# Interactive prompts for goal, audience, success criteria,
# the offer or value proposition, anti-goals
```

The brief should answer:

- **What's launching?** Concrete description of the feature/
  product
- **Who's it for?** Audience subset (existing customers,
  prospects, both); regulated audience considerations
- **What's the value proposition in one sentence?** Used as
  source for headlines across channels
- **What's the call to action?** Try free, sign up, schedule
  demo, watch video, etc.
- **What's the launch date or window?** Hard date informs
  cadence; window allows flex
- **What counts as success?** Specific metrics — feature
  adoption rate, sign-up count, press coverage count, brand
  mentions volume, organic traffic to landing page, ad CTR,
  etc.
- **Newsworthiness threshold** — does this warrant press? See
  Phase 8 for the heuristic.

**Mark complete**: `/workflows:manage complete campaign-brief`

## Phase 3 — Research check

Has the competitive landscape shifted since the last research
pass? If competitors shipped similar features in the last 90
days, the campaign positioning needs to address that.

```bash
# If research is stale (>90 days) or feature is in a contested category:
/product:strategy:research --features --semrush
# Otherwise, skip with a note in the brief
```

For features in established categories (where many competitors
have similar capabilities), the brief should explicitly position
the launch differently — not "we have X" but "our X has Y" or
"our approach to X is Z."

**Mark complete**: `/workflows:manage complete research-check`

## Phase 4 — Landing page

The landing page is the campaign's anchor — paid traffic lands
here, organic search lands here, social link clicks land here,
email CTAs click here. Every other channel assumes this exists.

```bash
/product:design:templates:landing-page launch-<slug>
# Reads the brief; generates design/templates/landing-<slug>.pen
# Applies SEO strategy from .pencil-seo.json automatically
```

Then generate the React implementation:

```bash
/frameworks:heroui:build-components design/templates/landing-<slug>.pen
# Emits SEO-correct HTML (semantic tags, JSON-LD, meta tags
# per the SEO strategy's per-archetype targets)
```

Verify the landing page works against:
- The campaign brief's value proposition (does the H1 match?)
- The SEO archetype targets (FAQ section if required, comparison
  table if required, structured data emission)
- The brand voice (Confident Mentor / etc. — does it sound
  right?)

**Mark complete**: `/workflows:manage complete landing-page`

## Phase 5 — SEO strategy adjustment (when warranted)

If the launch introduces new keyword targets, content cluster
nodes, or significant new content, update the SEO strategy:

```bash
/product:strategy:seo --audit
# Surface what's changed; decide if strategy needs update
```

When the launch warrants strategy changes (new pillar page in
the cluster, new primary keywords, new archetype targets):

```bash
/product:strategy:seo --explore  # or --from <existing-reference>
# Update .pencil-seo.json with new targets
```

Most launches don't require strategy changes — they fit the
existing pillar+cluster topology. Only update when the launch
genuinely shifts the discoverability strategy.

**Mark complete**: `/workflows:manage complete seo-update`

## Phase 6 — Email sequence

Generate the lifecycle email sequence for the launch. Minimum
three emails:

```bash
# Pre-launch announcement (1-2 weeks before)
/market:email:promotional launch-<slug>-announcement \
  --campaign launch-<slug> --cta-style soft

# Launch-day email (the moment)
/market:email:promotional launch-<slug>-launch-day \
  --campaign launch-<slug> --cta-style direct

# Post-launch follow-up (3-7 days after, for non-engagers)
/market:email:promotional launch-<slug>-followup \
  --campaign launch-<slug> --cta-style direct
```

For larger launches, add:
- A nurture email sequence (for users who clicked but didn't
  convert) — `/market:email:nurture`
- A welcome variant for users who sign up via the launch
  landing — `/market:email:welcome --variant launch-<slug>`

Each email's metadata records `campaignSlug: launch-<slug>` so
audit can verify cross-channel consistency.

**Mark complete**: `/workflows:manage complete email-sequence`

## Phase 7 — Ad campaigns

Generate ad creative across the formats the campaign budget
supports. Always start with paired ad+landing audit:

```bash
# Search ads (best when targeting active in-market intent)
/market:ads:search launch-<slug>-search-google \
  --platform google --campaign launch-<slug>

# Paid social (best when targeting interest-based audiences)
/market:ads:social launch-<slug>-meta-feed \
  --platform meta --placement instagram-feed \
  --format single-image --campaign launch-<slug>

# Retargeting (warm audience — visitors who didn't convert)
/market:ads:retargeting launch-<slug>-retarget-mid \
  --audience visited --stage mid --platform meta \
  --campaign launch-<slug>

# Display when budget supports brand-impression buy
/market:ads:display launch-<slug>-display \
  --campaign launch-<slug>

# Video when production budget warrants
/market:ads:video launch-<slug>-video-15s \
  --length 15s --orientation horizontal \
  --platform youtube --campaign launch-<slug>
```

Then audit ad↔landing message-match:

```bash
/market:ads:landing audit launch-<slug>
# Surfaces any keyword/headline/CTA mismatches
```

Fix gaps before launch. Misaligned ad↔landing pairs waste budget.

**Mark complete**: `/workflows:manage complete ad-campaigns`

## Phase 8 — Press (when newsworthy)

The newsworthiness threshold:

| Signal                                      | Newsworthy? |
| ------------------------------------------- | ----------- |
| Net-new product area or major capability    | Yes         |
| First-of-category or category-defining feature | Yes      |
| Significant scale milestone (100K users, $X ARR, major customer) | Yes |
| Industry partnership announcement | Yes (with partner alignment) |
| Funding round                  | Yes (separate workflow path; see below) |
| Feature parity with competitors | No (rarely earns coverage) |
| Iterative improvement to existing feature | No |
| Bug fix or maintenance | No |

When the launch crosses the threshold:

```bash
# Generate the press release
/market:pr:press-release launch-<slug> \
  --type product-launch \
  --spokesperson <ceo-or-product-lead> \
  --wire prnewswire --distribution-date <ISO>

# Generate journalist pitches for target reporters
/market:pr:journalist-outreach launch-<slug> \
  --journalist <name> --publication <name> \
  --beat <topic> --pitch-angle "<specific angle>"

# Update the newsroom
/market:pr:newsroom refresh
/product:design:templates:newsroom  # Regenerate with new release
```

Verify boilerplate is current (`design/marketing/pr/
boilerplate.json`) — stale customer counts or outdated funding
info embarrass the brand publicly.

When the launch doesn't cross the threshold, skip this phase
entirely. Forced press releases for non-news damage the brand's
relationship with journalists.

**Funding rounds** are a special case — different release type,
different compliance requirements (especially for public
companies), different journalist outreach playbook. Use
`/market:pr:press-release --type funding` and verify legal
counsel has approved the disclosure language before
distribution.

**Mark complete**: `/workflows:manage complete press-release`

## Phase 9 — Social organic campaign

The cross-platform organic social coordinator:

```bash
/market:social:campaign launch-<slug> generate \
  --platforms x,instagram,linkedin,tiktok \
  --brief "<campaign brief from Phase 2>" \
  --launch-date <ISO> \
  --cadence simultaneous
```

This invokes per-platform commands (`/market:social:x`,
`:instagram`, `:linkedin`, `:tiktok`, `:facebook` per the
selected platforms) with platform-adapted versions of the same
underlying message contract.

For TikTok, plan production lead time (storyboard → production
→ rendered video typically takes 3-7 days; account for it in
the campaign timeline).

After generation, audit cross-platform consistency:

```bash
/market:social:campaign launch-<slug> audit
# Surfaces voice drift, message-contract drift, schedule sanity
```

**Mark complete**: `/workflows:manage complete social-organic`

## Phase 10 — Coordination & launch day

The most underrated phase. Asset production is one thing; the
actual launch-day execution is where coordination breaks.

Build a **launch-day runbook** at `design/briefs/<slug>-runbook.md`
covering:

- **T-7 days**: pre-launch email sends; ad campaigns paused
  ready; social posts scheduled; press release embargoed;
  newsroom page staged
- **T-1 day**: final QA pass (run `/audit` last time);
  team alignment call; press embargo confirmed with
  journalists; landing page final preview
- **T-0 (launch day)**: in time order with timezone explicit
  - Hour 0: press embargo lifts; press release distributes via
    wire
  - Hour 0: newsroom page goes live
  - Hour 0: launch-day email sends
  - Hour 0+1: ad campaigns activate (pre-warmed audiences)
  - Hour 0+2: social organic posts publish (per platform peak
    hours; see `/market:social:campaign` schedule)
  - Hour 0+4: monitoring check — landing page traffic, email
    open rate, ad delivery, press coverage emerging
  - Hour 0+24: monitoring check — daily summary for the team
- **T+3 days**: post-launch email follow-up sends to non-
  engagers
- **T+7 days**: first measurement checkpoint — what's working,
  what isn't

Designate a **launch coordinator** — single person responsible
for runbook execution. Without this, launch-day email sends 6
hours before press goes live (or vice versa), and the campaign
loses its coherence.

**Mark complete**: `/workflows:manage complete coordination`

## Phase 11 — Post-launch retro

A week after launch, run retrospective:

```bash
# Generate a retro brief that captures what was planned vs what happened
/product:strategy:brief launch-<slug>-retro
# Interactive — captures the actual outcomes against Phase 2's success criteria
```

The retro should answer:

- Did the campaign hit its success criteria?
- Which channels overperformed / underperformed expectations?
- What broke during execution? (technical, coordination,
  content)
- What surprised the team?
- What should we do differently next launch?

Capture findings in `design/briefs/<slug>-retro.md`. Reference
this in the next launch campaign's Phase 2 brief — the retro
loop is how the team's launch playbook improves.

**Mark complete**: `/workflows:manage complete post-launch-retro`

## What this workflow does NOT do

- **Does not measure conversions or attribute revenue.** That's
  analytics work outside this suite. The workflow surfaces
  measurement intent in the brief; the team's analytics layer
  handles attribution.
- **Does not handle pre-launch user research / customer
  interviews.** When the feature is still in design, that's
  product-research work upstream of this workflow.
- **Does not handle internal launch enablement** (sales
  training, support runbook, internal email). The workflow is
  external-marketing-facing.
- **Does not handle paid PR / sponsored content.** When the
  launch coordinates with paid placements (sponsored articles,
  paid analyst coverage), that's PR-vendor work outside the
  suite.

## Reading the workflow state

State persists at `product/.pencil-workflow-state.json`. Resume
with `/workflows:manage resume`. Each phase's completion
records a timestamp; mid-launch the team can verify "we're in
Phase 7 (ad campaigns); Phase 8 (press) hasn't started" via
`/workflows:manage status`.
