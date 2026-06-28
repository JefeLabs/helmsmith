# GitRadar Executive Overview

## What It Is

GitRadar is a terminal-based analytics dashboard that visualizes engineering contribution data across multiple git repositories. It turns raw commit history into actionable team-level insights — without leaving the terminal.

## The Problem

Engineering leaders managing multi-team, multi-repo organizations lack a fast, lightweight way to answer:

- **How much is each organization contributing?** — Core teams vs. contractors, week over week.
- **What kind of work is each team doing?** — Feature code vs. tests vs. config vs. storybook vs. documentation.
- **Who are the top performers?** — And in which categories (app, test, config)?
- **Are trends healthy?** — Is test coverage keeping pace with feature work? Are averages stable?
- **What's the PR velocity and review culture?** — Cycle time, merge rate, review cadence.
- **Who are the unassigned contributors?** — New hires, contractors, or unknown emails appearing in git history.

Existing tools require browser-based dashboards, SaaS subscriptions, or complex CI pipelines. GitRadar runs locally against repos already on disk.

## How It Works

1. **Configure once** — Define your orgs, teams, members, and repo paths in a single `config.yml`. Or use the built-in Manage tab to set up everything interactively.
2. **Scan incrementally** — GitRadar runs `git log` across all repos, classifies every changed file, and stores results in a local SQLite database. Subsequent scans are incremental (only new commits).
3. **Enrich with GitHub data** — Optionally pull PR metrics (opened, merged, cycle time, reviews) and churn analysis via the GitHub API.
4. **Discover authors** — Unknown git authors are captured in an author registry and can be assigned to orgs/teams from the TUI or CLI.
5. **Explore interactively** — A keyboard-driven TUI presents four dashboard tabs with drill-down views, pivot modes, segmentation, and a full trends screen.

## Key Capabilities

| Capability | Description |
|------------|-------------|
| Multi-repo scanning | Scans any number of local git repositories in a single pass |
| SQLite storage | Durable, crash-safe storage with WAL mode and reactive file watching |
| Incremental updates | Staleness-aware cursors skip recently-scanned repos |
| File classification | Every file change is categorized as app, test, config, storybook, or doc |
| Commit intent tracking | Conventional commits parsed into feat/fix/refactor/docs/test/chore with scope and breaking change detection |
| GitHub enrichment | PR metrics, cycle time, review counts, and churn analysis via GitHub API |
| Org/team hierarchy | Supports multi-org structures with core and consultant designations |
| Interactive TUI | Four dashboard tabs with instant keyboard navigation |
| Drill-down views | Org → team → individual member drill with arrow keys |
| Pivot modes | Toggle between time-based and entity-based chart layouts |
| Segment filtering | Hide/show top 20%, middle 60%, or bottom 20% contributors (S key) |
| Per-user normalization | Toggle per-user averages to compare teams of different sizes (U key) |
| Granularity control | View data by week, month, quarter, or year with +/- keys |
| Time window control | Extend or shrink the visible time window with arrow keys |
| Detail layers | Cycle through compact, lines, and table detail modes (D key) |
| Author management | Discover, assign, move, and unassign authors from the TUI |
| Bulk assign | Assign authors by identifier prefix (e.g., "CON" for consultants) |
| Workspace management | Multiple workspaces with independent configs and data |
| Trend analysis | 12-week sparklines, line charts, running averages, and delta indicators |
| Leaderboards | Top 5 contributors across overall, app, test, and config categories |
| Demo mode | Fully synthetic reproducible dataset for evaluation and demos |
| Filtering | Slice by org, team, tag, repo group, or time window from the CLI |
| Export | CSV export, JSON export, and portable YAML workspace export/import |
| Auto-pruning | Configurable record retention with automatic cleanup |

## Data Model

The core data grain is **member x week x repo** — one record per person per ISO week per repository. Each record carries:

- Commit count and active days
- Insertions, deletions, net lines, files changed
- Breakdown by file type (app, test, config, storybook, doc)
- Commit intent distribution (feat, fix, refactor, docs, test, chore, other)
- Breaking change count and commit scopes

Enrichment data (stored separately) adds:
- PRs opened, merged, and branch type classification
- Average cycle time (open to merge)
- Reviews given and churn rate

This grain supports rollup by any dimension: org, team, tag, repo group, week, or individual.

## Technology

- **TypeScript** on Node.js — single `npm install`, no external services required
- **SQLite** via `better-sqlite3` — durable local storage with WAL mode for crash safety
- **Zero cloud dependencies** — all data stays local in `~/.agentx/gitradar/`
- **Optional GitHub API** — enrichment features use `octokit` for PR and review data
- **841 tests** across 40 test files — full coverage of collector, aggregator, UI, views, CLI, store, and export/import
- **Sub-second scans** for incremental updates on warm repos

## Who It's For

- **Engineering managers** tracking multi-team output and work-type balance
- **Directors/VPs** comparing org-level contribution patterns over time
- **Tech leads** identifying individual trends and onboarding ramp-up
- **Consultancy managers** measuring contractor vs. core team ratios

## Quick Start

```bash
npm install
npm run build
gitradar init          # prints config.yml setup instructions
gitradar --demo        # launch with synthetic data (no repos needed)
gitradar               # launch with real repo data
```

## CLI Command Groups

| Command | Description |
|---------|-------------|
| `gitradar` | Launch the full interactive TUI |
| `gitradar scan` | Scan repos and exit (no TUI) |
| `gitradar workspace` | Create, list, and switch workspaces |
| `gitradar repo` | Add, list, and remove repos |
| `gitradar org` | Manage organizations and teams |
| `gitradar author` | List, assign, and bulk-assign authors |
| `gitradar view` | CLI-only views (contributions, leaderboard, repo-activity, trends) |
| `gitradar data` | Export CSV, export/import portable YAML, enrich with GitHub data |
