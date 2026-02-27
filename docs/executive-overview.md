# GitRadar Executive Overview

## What It Is

GitRadar is a terminal-based analytics dashboard that visualizes engineering contribution data across multiple git repositories. It turns raw commit history into actionable team-level insights — without leaving the terminal.

## The Problem

Engineering leaders managing multi-team, multi-repo organizations lack a fast, lightweight way to answer:

- **How much is each organization contributing?** — Core teams vs. contractors, week over week.
- **What kind of work is each team doing?** — Feature code vs. tests vs. config vs. storybook.
- **Who are the top performers?** — And in which categories (app, test, config)?
- **Are trends healthy?** — Is test coverage keeping pace with feature work? Are averages stable?

Existing tools require browser-based dashboards, SaaS subscriptions, or complex CI pipelines. GitRadar runs locally against repos already on disk.

## How It Works

1. **Configure once** — Define your orgs, teams, members, and repo paths in a single `config.yml`.
2. **Scan incrementally** — GitRadar runs `git log` across all repos, classifies every changed file, and stores results locally. Subsequent scans are incremental (only new commits).
3. **Explore interactively** — A keyboard-driven TUI presents four dashboard tabs, drill-down views for teams and individuals, and a full trends screen.

## Key Capabilities

| Capability | Description |
|------------|-------------|
| Multi-repo scanning | Scans any number of local git repositories in a single pass |
| Incremental updates | Staleness-aware cursors skip recently-scanned repos |
| File classification | Every file change is categorized as app, test, config, or storybook |
| Org/team hierarchy | Supports multi-org structures with core and consultant designations |
| Interactive TUI | Four dashboard tabs with instant keyboard navigation |
| Drill-down views | Team detail and individual member detail screens |
| Trend analysis | 12-week sparklines, line charts, running averages, and delta indicators |
| Leaderboards | Top 5 contributors across overall, app, test, and config categories |
| Demo mode | Fully synthetic reproducible dataset for evaluation and demos |
| Filtering | Slice by org, team, tag, repo group, or time window from the CLI |
| JSON export | Dump filtered data as JSON for integration with other tools |

## Data Model

The core data grain is **member x week x repo** — one record per person per ISO week per repository. Each record carries:

- Commit count and active days
- Insertions, deletions, net lines, files changed
- Breakdown by file type (app, test, config, storybook)

This grain supports rollup by any dimension: org, team, tag, repo group, week, or individual.

## Technology

- **TypeScript** on Node.js — single `npm install`, no external services
- **Zero cloud dependencies** — all data stays local in `~/.agentx/gitradar/`
- **463 tests** across 24 test files — full coverage of collector, aggregator, UI, and views
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
gitradar --json        # export filtered data as JSON
```
