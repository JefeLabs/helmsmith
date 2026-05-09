# Getting Started — gitradar

This guide takes you from zero to a working gitradar dashboard in
about 10 minutes. Two paths:

1. **Demo mode** — instant dashboard against synthetic data, useful
   for evaluating the tool before committing real configuration.
2. **Real mode** — point gitradar at your actual git repos, model
   your team structure, launch the dashboard.

## Prerequisites

- **Node.js ≥ 20**. Check with `node --version`.
- One or more local git clones to analyze. They can live anywhere on
  your filesystem.
- (Optional) A GitHub Personal Access Token if you want PR / cycle
  time enrichment.

## Path 1 — Demo mode (fastest)

```bash
npm install -g @agentx/gitradar
gitradar --demo
```

A reproducible synthetic dataset (orgs, teams, members, weeks of
contribution data) is generated in-memory; the TUI launches against
it. Use this to:

- Evaluate the dashboard layout
- Try keyboard shortcuts (drill, pivot, segment filtering)
- Decide whether the tool fits your needs

Quit with `q`. The synthetic data isn't persisted; you can re-run
`gitradar --demo` repeatedly without affecting any real config.

## Path 2 — Real mode (production setup)

### Step 1 — Initialize a workspace

```bash
gitradar init
```

This creates `~/.agentx/gitradar/` with:

- `config.yml` — your workspace's config (orgs, teams, repos, settings)
- A SQLite database for storing scan results

Multiple workspaces are supported (e.g., one for personal repos, one
for work). Switch between them with `gitradar workspace use <name>`.

### Step 2 — Add repos

Two ways: scanning a directory for git repos, or adding individual
paths.

```bash
# Scan a parent directory and discover all git repos under it
gitradar repo add ~/code/

# Add a single repo by path
gitradar repo add ~/code/my-project --name my-project --group web
```

Verify:

```bash
gitradar repo list
```

### Step 3 — Run an initial scan

```bash
gitradar scan
```

This walks every configured repo, runs `git log` over its full
history, classifies each changed file (app / test / config /
storybook / doc), parses commit intent (feat / fix / refactor /
docs / test / chore), and writes the per-author per-week per-repo
records to SQLite.

The first scan can take a few minutes for repos with long histories.
Subsequent scans are **incremental** — only new commits since the
last scan are processed.

For a forced full re-scan:

```bash
gitradar scan --force-scan
```

### Step 4 — Model your organization

Real teams have orgs, teams, members, and contractors. gitradar
captures this hierarchy.

#### Add an organization with teams

```bash
gitradar org add --name "Acme Corp" --type core --team Platform --tag infra
gitradar org add --name "Acme Corp" --team Frontend --tag web
gitradar org add --name "ContractCo" --type consultant
```

`--type core` vs `--type consultant` is the key distinction — leadership
dashboards typically segment these separately so contractor output
doesn't dilute the core team's signal.

#### Discover unassigned authors

After the first scan, gitradar will have collected every git author
that's appeared in your repos. List the ones that haven't been
assigned to any org/team yet:

```bash
gitradar author list --unassigned
```

#### Assign authors

```bash
# Assign one author to a team
gitradar author assign alice@company.com --org "Acme Corp" --team Platform

# Bulk-assign by email/identifier prefix (great for contractor cohorts)
gitradar author bulk-assign --prefix CON --org ContractCo --team Squad
```

You can also do this interactively from the TUI's **Manage** tab —
many users prefer that for the initial setup.

### Step 5 — Launch the dashboard

```bash
gitradar
```

Four tabs:

| Tab | What it shows |
|---|---|
| **Contributions** | Stacked bar charts grouped by org/team/user with full drill-down |
| **Repo Activity** | Per-repo contribution volume by organization |
| **Top Performers** | Leaderboards across overall, app, test, and config categories |
| **Manage** | Add repos, create orgs/teams, assign authors interactively |

Navigate with:

- `Tab` — next tab
- `↓` / `↑` — drill deeper / shallower (org → team → user)
- `+` / `-` — finer / coarser granularity (week ↔ month ↔ quarter ↔ year)
- `←` / `→` — shrink / extend time window
- `D` — cycle detail mode (chart → lines → table)
- `V` — pivot (time-on-X ↔ entity-on-X)
- `U` — toggle per-user normalization
- `S` — segment filter menu (top 20%, middle 60%, bottom 20%)
- `T` — toggle tag overlay
- `H` — toggle unassigned-author visibility
- `1`–`9` — drill into the numbered team
- `Q` — quit

The full keyboard reference is in
[feature-overview.md](feature-overview.md).

### Step 6 — (Optional) Enrich with GitHub data

PR cycle time, review counts, and churn analysis require GitHub API
access:

```bash
export GITHUB_TOKEN="ghp_..."
gitradar data enrich
```

The token only needs `repo` scope. Data is cached locally so
subsequent dashboard launches don't re-hit the API.

## Common workflows

### Compare last 8 weeks for one org

```bash
gitradar -w 8 --org "Acme Corp"
```

### Run as a non-interactive report (for emails, Slack, CI)

```bash
gitradar view contributions --json
gitradar view leaderboard -w 8
gitradar view repo-activity
gitradar view trends
```

### Export raw data to CSV

```bash
gitradar data export-csv -o report.csv
```

### Backup/share your workspace config

```bash
gitradar data export                     # writes portable YAML
gitradar data import workspace-backup.yml
```

The portable YAML format includes orgs, teams, members, and repo
config — but NOT the scanned commit data (which is local SQLite). Use
this to share workspace setup with teammates or commit it to a repo.

### Add an existing dotfile/config repo

Some repos are mostly config (e.g., infra-as-code, dotfiles). gitradar
classifies these correctly — config-heavy weeks show up as config
churn rather than features:

```bash
gitradar repo add ~/code/infra --group infrastructure
gitradar scan
```

The "Top Performers — Config" leaderboard surfaces who's been doing
the most platform work, separately from feature output.

### Re-classify a custom file pattern

By default, gitradar's classification rules cover most JavaScript /
TypeScript / Python projects out of the box. To customize for unusual
project layouts, edit `~/.agentx/gitradar/config.yml` under the
`classification` section (see [architecture.md](architecture.md) for
the rule format).

## Troubleshooting

### "No repos configured"

You ran `gitradar` without adding any repos. Add some:

```bash
gitradar repo add ~/code
gitradar scan
```

### Dashboard is empty

The repos you added might not have commits in the visible time window
(default: 12 weeks). Extend it with `→` arrows in the TUI, or pass
`-w 52` to see a year:

```bash
gitradar -w 52
```

### "All authors are unassigned"

You haven't run org/author setup yet. Either use the **Manage** tab
in the TUI or the CLI:

```bash
gitradar author list --unassigned
gitradar author assign <email> --org <org> --team <team>
```

### Scans are slow on large repos

The first scan walks full history; this is a one-time cost. Subsequent
scans are incremental. If the first scan is too slow:

```bash
# Limit scan history to recent N weeks (config option)
# Edit ~/.agentx/gitradar/config.yml:
#   settings:
#     max_scan_age_weeks: 26
```

Then re-scan with `gitradar scan --force-scan`.

### TUI rendering is broken

gitradar's TUI requires a terminal that supports modern ANSI escape
codes and 256-color or 24-bit color. iTerm2, Kitty, Alacritty, modern
macOS Terminal, and Windows Terminal all work. If you're on a
constrained terminal (basic SSH session, legacy emulator), use the
non-TUI commands (`gitradar view contributions`, etc.) which produce
plain-text or JSON output.

### Reset everything

```bash
rm -rf ~/.agentx/gitradar/
gitradar init                            # fresh setup
```

This wipes all configured repos, orgs, members, and scan data. Don't
do this casually — there's no undo.

## What's next

- **[feature-overview.md](feature-overview.md)** — the full guided
  tour of every dashboard tab and CLI command.
- **[architecture.md](architecture.md)** — how the scanner,
  classifier, aggregator, and TUI fit together. Useful if you're
  customizing classification rules or contributing to gitradar.
- **[executive-overview.md](executive-overview.md)** — high-level
  framing for sharing with non-engineers.
