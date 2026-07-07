# Marketing Workflows — Domain Context (`market/workflows/`)

> Read this in addition to `workflows/_context.md`,
> `market/_context.md`, and `product/strategy/_context.md` whenever
> working with marketing workflow playbooks.
>
> This sub-namespace holds workflow playbooks whose primary
> orchestration concern is marketing. Per the primary-domain
> placement rule (see `workflows/_context.md`), workflows that
> coordinate marketing channels (email, ads, social, PR) and
> marketing planning (calendar) live here, even when they invoke
> commands from other namespaces (pencil, heroui, product).

## Workflows in this sub-namespace

5 workflows currently:

- **`market:launch-campaign`** — Coordinated feature/product
  launch across email + ads + social organic + PR + landing pages
- **`market:reactivation-campaign`** — Win back lapsed users via
  email + retargeting
- **`market:seasonal-campaign`** — Calendar-tied promotion with
  sunset discipline (Black Friday, year-end, back-to-school)
- **`market:marketing-calendar-annual`** — Strategic 12-month
  marketing arc planning
- **`market:marketing-calendar-monthly`** — Tactical 4-6 week
  schedule

See `workflows/_index.md` for the unified decision tree across
all domains, including these.

## Conventions specific to marketing workflows

Beyond the universal workflow conventions in
`workflows/_context.md`:

### Voice + tone awareness throughout

Marketing workflows read `product/.pencil-tone.json` and apply the
established voice to every channel asset they generate. The PR
voice exception (third-person formal regardless of brand voice)
applies inside `market:launch-campaign` Phase 8 and the press-
release portions of seasonal campaigns. See
`market/_context.md` for the full voice exception rule.

### Cross-channel coordination

Marketing workflows orchestrate multiple channels (email + ads +
social + PR). The workflow's job is **coordination** — timing,
message-match across channels, capacity-aware sequencing — not
asset production. Channel-specific commands (e.g.,
`/market:email:promotional`, `/market:ads:search`) produce
the actual assets.

### Calendar interaction

The two calendar workflows (`marketing-calendar-annual`,
`marketing-calendar-monthly`) write to
`product/.pencil-marketing-calendar.json`. Campaign workflows
(`launch-campaign`, `reactivation-campaign`, `seasonal-campaign`)
optionally read it for capacity context. The calendar feeds the
campaigns; campaigns don't modify the calendar except via
explicit calendar workflow runs.

### Newsworthiness threshold (launch-campaign Phase 8)

Phase 8 of `launch-campaign` includes an explicit newsworthiness
threshold table that determines whether the launch warrants press
coverage. This is the workflow's most opinionated phase — it
forces the team to make the press decision honestly rather than
defaulting to "always do PR" or "never do PR."

### Sunset discipline (seasonal-campaign Phase 9)

Phase 9 of `seasonal-campaign` is a dedicated sunset phase — pause
ads, take down landing page, archive social posts, restore
non-seasonal creative. Easy to skip; creates real damage when
skipped (Black Friday landing page still up in February).

## Anti-patterns

- **Marketing workflows that produce assets directly** instead of
  delegating to channel commands. Workflows orchestrate; commands
  produce.
- **Marketing workflows under `product/strategy/workflows/`** — pre-W-1
  refactor placement that's now an anti-pattern. All marketing
  workflows live here.
- **Press release workflows for non-newsworthy launches** — forces
  the team to make the press decision via the threshold table in
  `launch-campaign` Phase 8 rather than defaulting either way.
