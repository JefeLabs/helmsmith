# GitRadar

Terminal-based TUI analytics for git contribution data across multiple repositories.

GitRadar scans your local git repos, classifies every file change, and presents interactive dashboards — all without leaving the terminal. Track org-level output, drill into individual contributors, compare core teams vs. contractors, and spot trends over time.

## Quick Start

```bash
npm install
npm run build

# Try it instantly with synthetic data
gitradar --demo

# Set up with your own repos
gitradar init
gitradar repo add ~/code/my-project
gitradar
```

## What You Get

- **Contributions tab** — Grouped stacked bar charts by org/team/user with drill-down, pivot, granularity, and segment filtering
- **Repo Activity tab** — Per-repo contribution volume by organization
- **Top Performers tab** — Leaderboards across overall, app, test, and config categories
- **Scorecard tab** — Per-member scorecard — throughput, flow, quality, collaboration; each metric vs the member's own baseline and the cohort percentile; opt-in weighted score
- **Manage tab** — Add repos, create orgs/teams, assign authors — all from the TUI
- **Trends view** — 12-week sparklines, line charts, running averages, and test ratio trends

## Key Features

| Feature | Description |
|---------|-------------|
| Multi-repo scanning | Scans any number of local git repos with incremental updates |
| File classification | Categorizes changes as app, test, config, storybook, or doc |
| Noise filtering | Lock files, dependency/build dirs, and generated files never count; lockfile-only commits are skipped |
| Commit intent | Parses conventional commits (feat/fix/refactor/docs/test/chore) |
| GitHub enrichment | Pulls PR metrics, median cycle time, and PRs reviewed via GitHub API |
| Segment filtering | Hide/show top 20%, middle 60%, or bottom 20% contributors |
| Per-user normalization | Compare teams of different sizes fairly |
| Org/team hierarchy | Core vs. consultant designations with full drill-down |
| Workspace management | Multiple independent workspaces |
| Export/import | CSV, JSON, and portable YAML formats |

## Usage

```bash
# Interactive dashboard
gitradar                                # launch TUI
gitradar --demo                         # demo with synthetic data
gitradar -w 8 --org "Acme Corp"         # filter to 8 weeks, one org
gitradar --prune 26                     # remove records older than 26 weeks, then launch

# Scanning
gitradar scan                           # scan and exit
gitradar scan --force-scan              # clears each repo's records and cursors, then re-walks history
gitradar scan --skip-rework             # skip the blame-based rework pass (faster scans, no rework% on the Scorecard)

# Repo management
gitradar repo add ~/code/project        # discover repos in directory
gitradar repo list                      # list configured repos
gitradar repo remove frontend-app       # remove a repo

# Org & author management
gitradar org add --name "Acme" --type core --team Platform --tag infra
gitradar author list --unassigned
gitradar author assign alice@co.com --org Acme --team Platform
gitradar author bulk-assign --prefix CON --org ContractCo --team Squad

# CLI reports (non-interactive)
gitradar view contributions --json
gitradar view leaderboard -w 8
gitradar view repo-activity
gitradar view trends
gitradar view scorecard -w 8 --family quality

# Data management
gitradar data export-csv -o report.csv
gitradar data export                    # portable YAML
gitradar data import backup.yml
gitradar enrich                         # pull GitHub PR data
```

## Keyboard Shortcuts

Each tab's own letter (`C`, `R`, `P`, `K`, `M`) jumps straight to that tab from anywhere in the dashboard, unless the active tab already uses that letter for something else — `Tab` always cycles to the next tab regardless.

### Contributions Tab

| Key | Action |
|-----|--------|
| `↓`/`↑` | Drill deeper/shallower (org → team → user) |
| `+`/`-` | Finer/coarser granularity (week ↔ month ↔ quarter ↔ year) |
| `←`/`→` | Shrink/extend time window |
| `D` | Cycle detail mode (chart → lines → table) |
| `V` | Pivot (by time ↔ by entity) |
| `U` | Toggle per-user normalization |
| `S` | Segment filter menu |
| `T` | Toggle tag overlay |
| `H` | Toggle unassigned visibility |
| `1`-`9` | Drill into numbered team |
| `Tab` | Next tab |
| `Q` | Quit |

### Scorecard Tab

| Key | Action |
|-----|--------|
| `1`/`2`/`3` | Window: 4 / 8 / 12 weeks |
| `F` | Cycle family (all → throughput → flow → quality → collab) |
| `N` | Cycle mode (value → delta → percentile) |
| `←`/`→` | Move sort column |
| `R` | Reverse sort direction |
| `Tab` | Next tab |
| `Q` | Quit |

## Configuration

GitRadar stores data in `~/.agentx/gitradar/`. Configuration is a single YAML file:

Repos are managed through the workspace registry (`gitradar repo add`), never
in `config.yml` — a `repos:` key here is ignored (with a warning) if present.

```yaml
orgs:
  - name: Acme Corp
    type: core
    teams:
      - name: Platform
        tag: infrastructure
        members:
          - name: Alice Chen
            email: alice@company.com
            aliases: [alice.chen]

settings:
  weeks_back: 12
  staleness_minutes: 60
  ignore_patterns: ["*.fixture.json"]   # extends the built-in list
```

Lock files, `node_modules/`, `vendor/`, build output, snapshots, and other
generated files are ignored out of the box; a commit that touches only ignored
files is not counted at all. Add your own patterns with `ignore_patterns`
(additive), or set `ignore_patterns_replace_defaults: true` to start from an
empty list. `GITRADAR_HOME` relocates the whole `~/.agentx/gitradar` directory.

Or skip the YAML and configure everything from the **Manage tab** in the TUI.

## Documentation

- [Executive Overview](docs/executive-overview.md) — What GitRadar is, who it's for, and key capabilities
- [Feature Tour](docs/feature-overview.md) — Walkthrough of every feature, CLI command, and keyboard shortcut
- [Architecture](docs/architecture.md) — System design, data flow, layer responsibilities, and testing strategy

## Tech Stack

- **TypeScript** on **Bun** (`bun:sqlite`) — GitRadar requires the Bun runtime; `bin/gitradar` execs the vendored `bun` binary from the `bun` npm dependency. `npm install --ignore-scripts` is unsupported.
- **SQLite** (`bun:sqlite`) — local storage with WAL mode
- **Commander** — CLI argument parsing (via `@helmsmith/cli-kit`)
- **Octokit** — optional GitHub API enrichment
- **Zod** — schema validation
- **Vitest** — see `npm test` for current counts

## License

Private — all rights reserved.
