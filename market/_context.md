# Market — Grouping Context

> The marketer persona's grouping. Read this when working
> anywhere under `market/`.
>
> The marketer is the persona handling marketing across all
> channels — content strategist, communications lead, marketer
> running campaigns and brand voice.

## What `market/` contains

```
market/
├── _context.md                  (this file)
├── tone/                        voice strategy
├── email/                       email channel
├── ads/                         ads channels
├── social/                      social channels (X, Instagram, LinkedIn,
│                                  Facebook, TikTok)
├── pr/                          press releases, journalist outreach,
│                                  media kits, newsroom
└── workflows/                   campaign workflows + calendar workflows
```

Sub-namespaces are hoisted directly into `market/` (no
intermediate `market/marketing/` nesting). This means
invocations are concise: `/market:email:newsletter` rather
than `/market:marketing:email:newsletter`.

## Sub-namespaces

### `tone/` — voice strategy

Brand voice exploration (`tone:explore`), refinement
(`tone:refine`), and testing (`tone:test`). Produces the
`.pencil-tone.json` manifest that every channel consumes.

Voice is a brand foundation. Designer establishes initial brand
identity (visual + voice baseline); marketer iterates voice via
tone commands. Both personas may author tone; the manifest
supports both authorship paths.

### `email/` — email channel

Newsletter, nurture sequences, promotional, transactional,
welcome flows. Each command produces channel-specific copy
respecting the project's tone, editorial conventions, and
marketing calendar.

### `ads/` — ads channels

Display ads, search ads, social ads, video ads, retargeting,
landing page generation (with SEO message-match scoring).
Channel-specific ad creative and landing pages.

### `social/` — social channels

Channel-specific commands: X (Twitter), Instagram, LinkedIn,
Facebook, TikTok. Plus a campaign command that orchestrates
social posts across channels for a coordinated push.

### `pr/` — public relations

Press releases, journalist outreach, media kits, newsroom
content. The PR voice (third-person formal) is the suite's
only one-voice exception — it overrides the brand voice
because PR convention requires it.

### `workflows/` — marketing workflows

Multi-phase orchestration playbooks:

- `launch-campaign` — coordinated feature/product launch across
  email + ads + social + PR + landing page
- `reactivation-campaign` — win back lapsed users via email
  reactivation + retargeting + landing
- `seasonal-campaign` — calendar-tied promotion with sunset
  discipline
- `marketing-calendar-annual` — strategic 12-month marketing
  arc planning
- `marketing-calendar-monthly` — tactical 4-6 week schedule

When invoked: `/workflows:manage start market:<workflow-slug>`.

## Marketer's typical workflows

### Coordinated launch

```
/workflows:manage start market:launch-campaign
```

Multi-week production + 1-2 days execution. Coordinates
landing page, email sequence, ads, social organic, PR
(if newsworthy), launch-day runbook, post-launch retro.

### Annual marketing planning

```
/workflows:manage start market:marketing-calendar-annual
```

Single working session (4-8 hours). Establishes themes per
quarter, slots in major launches, sets channel cadence
calibrated to honest team capacity. Persists to
`.pencil-marketing-calendar.json`.

### Tactical schedule

```
/workflows:manage start market:marketing-calendar-monthly
```

Every 4-6 weeks. Specifies actual posts, emails, ads to produce
on which dates. Surfaces gaps and overload before the period
begins.

### Win-back campaign

```
/workflows:manage start market:reactivation-campaign
```

For lapsed-user reactivation. Audience definition →
reactivation email sequence → sequential retargeting creative
→ optional landing → suppression list management.

## Cross-persona reads

Marketer commands read from designer-authored manifests:

- `.pencil-tone.json` — voice strategy applied to every
  channel asset (email copy, ad copy, social posts)
- `.pencil-brand.json` — brand identity (name, key
  propositions, terminology) used in copy
- `.pencil-editorial.json` — writing conventions (sentence
  length, capitalization, terminology preferences)

Marketing also writes its own manifests that designer commands
read:

- `.pencil-marketing.json` — campaign context surfaced during
  landing page design
- `.pencil-marketing-calendar.json` — marketing windows that
  affect design priorities

## Voice exception (PR namespace)

PR is the suite's only one-voice exception. Press releases use
**third-person formal voice** regardless of brand voice. This
isn't a marketer choice; it's a press industry convention that
journalists expect.

Brand voice attributes (conversational, irreverent, technical,
warm) apply to email, ads, social, marketing copy. They do NOT
apply to press releases. The `pr/_context.md` documents this
exception in detail.

When the marketer runs `/market:pr:press-release`, the command
reads `.pencil-tone.json` for awareness but applies PR voice
override.

## Manifest authorship

Marketer-authored manifests:

- `.pencil-marketing.json` — campaign inventory and context
- `.pencil-marketing-calendar.json` — annual + monthly
  marketing calendar
- `.pencil-editorial.json` — writing conventions (often
  co-authored with designer; marketer iterates)
- `.pencil-seo.json` — SEO + AIO strategy

Marketer-co-authored manifests (designer drives initial,
marketer iterates):

- `.pencil-tone.json` — voice strategy

## Anti-patterns

- **Bypassing the calendar workflow for ad-hoc campaigns** —
  the calendar is honest capacity planning; ignoring it leads
  to overload and dropped deadlines. If a campaign isn't on
  the calendar, the calendar workflow needs to be re-run with
  the campaign included, or the campaign needs to wait.
- **Voice consistency lapses** — every channel asset reads
  `.pencil-tone.json`. If a generated email "feels off"
  compared to other channels, it's almost always a tone-
  manifest gap or staleness, not a per-command bug.
- **Press releases in brand voice** — PR voice override is
  enforced by the PR namespace's commands. Don't fight it.
- **Marketing workflows producing assets directly** —
  workflows orchestrate; commands produce. A workflow that
  generates an email body inline is bypassing
  `/market:email:promotional` and creating drift risk.
- **Newsworthiness inflation** — `launch-campaign` Phase 8
  has an explicit newsworthiness threshold table. Don't run
  press releases for non-newsworthy launches; journalists
  notice and ignore future PR.
