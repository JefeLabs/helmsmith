# GitRadar Feature Tour

A walkthrough of every feature in the GitRadar TUI, organized by how you'd use them in a typical session.

---

## 1. CLI Entry Points

### Default: Interactive Dashboard

```bash
gitradar                     # launch the full TUI
gitradar --demo              # use synthetic data (no repos needed)
gitradar -w 8 --team Platform # filter to 8 weeks, Platform team only
```

### Scan Only

```bash
gitradar scan                # scan repos, print results, exit (no TUI)
gitradar scan --force-scan   # full re-scan ignoring staleness
```

### Trends Direct

```bash
gitradar trends              # jump straight to the trends screen
```

### Data Management

```bash
gitradar --store-stats       # print record count, orgs, teams, week range
gitradar --prune 90          # drop records older than 90 days
gitradar --reset             # delete all data files, start fresh
gitradar --json              # dump filtered records as JSON to stdout
```

### Filtering Flags

All filters apply globally and can be combined:

| Flag | Effect |
|------|--------|
| `--org "Acme Corp"` | Show only one organization |
| `--team Platform` | Show only one team |
| `--tag infrastructure` | Show only one tag |
| `--group backend` | Show only repos in a group |
| `-w 8` | Override weeks of history |

---

## 2. Dashboard Tabs

The dashboard is the main screen. Four tabs are accessible via single-keypress hotkeys.

### Tab C: Contributions

The default landing tab. Shows a **grouped stacked horizontal bar chart** of lines changed per week.

- **Expand modes**: Press `O` for org-level, `E` for team-level, `G` for tag-level
- **Time windows**: Press `W` to cycle through 4 weeks, 8 weeks, and 3 months
- **Detail table**: Press `D` to toggle between the chart and a data table showing commits, avg size, files added/deleted, lines added/deleted, and net per group per week
- **Drill-down**: Press `1`-`9` to jump into a numbered team's detail view

Each bar is color-coded by file type:
- `█` green = app code
- `▓` blue = test code
- `░` yellow = config files
- `▒` magenta = storybook

Core teams are prefixed with `★`, consultants with `◆`.

### Tab A: Avg Output

Shows **per-person average output** with a running average marker (`◈`).

- Each bar = this week's avg lines/person for the group
- The `◈` marker = 3-month running average per person
- Bar past marker = above-average week; bar short = below-average
- Toggle between org-level (`O`) and team-level (`E`) grouping

### Tab R: Repo Activity

**Per-repo horizontal bar chart** showing contribution volume by org.

- Repos sorted by total activity (descending)
- Each repo is a group; bars within it represent different orgs
- Time windows: `1` (4 weeks), `2` (8 weeks), `3` (3 months)
- Footer shows total repo count and total lines changed

### Tab P: Top Performers (Leaderboard)

**Four-column leaderboard**: Overall, App Code, Test Code, Config.

- Top 5 contributors per category
- Each entry shows: rank, name, value, team, and a mini stacked bar
- Time windows: `1` (4 weeks), `2` (8 weeks), `3` (3 months)

---

## 3. Team Detail View

Accessed by pressing a numbered key (`1`-`9`) on the dashboard Contributions tab.

### Sections

1. **Banner** — Team name, org, tag, and current week range
2. **File Type by Member** — Horizontal bars per member for the current week, with `◈` running average markers
3. **Member Activity (12 weeks)** — Multi-series line chart, one colored line per team member
4. **Members Table** — Name, Commits, +Ins, -Del, Net, Breakdown (stacked bar), Delta vs. previous week
5. **Repos Table** — Repo, Commits, +Ins, -Del, Top Contributor, Group

### Navigation

- `1`-`9` — Drill into a numbered member's detail view
- `B` — Back to dashboard
- `Q` — Quit

---

## 4. Member Detail View

Accessed from the Team Detail view by pressing a member's number.

### Sections

1. **Banner** — Member name, team, org, and week range
2. **File Type by Week** — Grouped horizontal bars for the last 3 weeks
3. **Activity (12 weeks)** — Three-series line chart:
   - Solid cyan = commits
   - Solid green = lines added
   - Dotted yellow = net lines
4. **Repos Table** — Repo, Commits, +Ins, -Del, Breakdown, Delta vs. previous week
5. **12-Week Summary** — Average commits/week, average lines/week, test ratio %

### Navigation

- `B` — Back to team detail
- `Q` — Quit

---

## 5. Trends View

Full-screen historical analysis. Accessed from the dashboard by pressing `T`.

### Sections

1. **Commits/Week Line Chart (12 weeks)** — One series per org/team/tag, 12 rows tall
2. **File Type Breakdown (12 weeks)** — Full grouped horizontal bars for every week in the window
3. **Avg Output per Person (sparklines)** — Per-team sparkline using `▁▂▃▄▅▆▇█` characters, avg lines/person/week, and running average value
4. **Test Ratio Sparkline** — Per-team test ratio trend with direction indicator (up/flat/down)

### Expand Modes

- `O` — Group by org
- `E` — Group by team
- `G` — Group by tag
- `B` — Back to dashboard
- `Q` — Quit

---

## 6. File Classification

Every changed file in every commit is automatically classified:

| Category | Examples |
|----------|----------|
| **App** | `src/index.ts`, `lib/utils.py`, `components/Button.tsx` |
| **Test** | `*.test.ts`, `*.spec.js`, `__tests__/*`, `cypress/*`, `playwright/*` |
| **Config** | `*.json`, `*.yml`, `Dockerfile`, `.github/*`, `*.lock`, `tsconfig*` |
| **Storybook** | `*.stories.tsx`, `.storybook/*`, storybook `.mdx` files |

Classification priority: storybook > test > config > app (first match wins).

---

## 7. Incremental Scanning

GitRadar tracks scan state per repo to avoid redundant work:

- **Staleness check** — Repos scanned within the staleness window (default: 60 minutes) are skipped
- **Hash deduplication** — Recent commit hashes are stored (last 500 per repo) to prevent double-counting
- **Since-date optimization** — Incremental scans use `lastScanDate - 1 day` as the `--since` argument
- **Force scan** — `--force-scan` bypasses all staleness checks

Terminal output during scan:
```
✓ frontend-app: +12 commits → 8 new records
✓ api-server: +5 commits → 3 new records
· shared-lib: fresh (23m ago)
```

---

## 8. Demo Mode

```bash
gitradar --demo
```

Generates a fully synthetic but reproducible dataset:

- **2 orgs**: Acme Corp (core), ContractCo (consultant)
- **5 teams**: Platform, Product, Mobile, Frontend Squad, Data Squad
- **15 members** with realistic contribution patterns
- **8 repos** across 6 groups (web, backend, mobile, shared, infra, data)
- **Team-to-repo affinity** — each team works primarily in 2-4 repos
- **Deterministic** — seeded PRNG produces identical data every run

Useful for evaluation, demos, and UI development without real repositories.

---

## 9. Configuration

Single YAML file at `~/.agentx/gitradar/config.yml`:

```yaml
repos:
  - path: ~/code/frontend-app
    name: frontend-app
    group: web

orgs:
  - name: Acme Corp
    type: core
    teams:
      - name: Platform
        tag: infrastructure
        members:
          - name: Alice Chen
            email: alice@company.com
            aliases: [alice.chen, achen]

settings:
  weeks_back: 12
  staleness_minutes: 60
```

Key configuration features:
- **Aliases** — Match commits from multiple email addresses or names to one person
- **Groups** — Categorize repos (web, backend, mobile, etc.)
- **Tags** — Cross-team categorization (infrastructure, feature, analytics)
- **Org types** — Distinguish `core` teams from `consultant` teams
- **Path resolution** — Supports `~` expansion and relative paths (resolved against config location)

---

## 10. Keyboard Reference

### Dashboard

| Key | Action |
|-----|--------|
| `C` | Contributions tab |
| `A` | Avg Output tab |
| `R` | Repo Activity tab |
| `P` | Top Performers tab |
| `E` | Expand by team |
| `G` | Expand by tag |
| `O` | Collapse to org |
| `W` | Cycle time window |
| `D` | Toggle chart/detail table |
| `1`-`9` | Drill into numbered team |
| `T` | Open Trends view |
| `Q` | Quit |

### Team Detail

| Key | Action |
|-----|--------|
| `1`-`9` | Drill into numbered member |
| `B` | Back to dashboard |
| `Q` | Quit |

### Member Detail

| Key | Action |
|-----|--------|
| `B` | Back to team |
| `Q` | Quit |

### Trends

| Key | Action |
|-----|--------|
| `E` | Expand by team |
| `G` | Expand by tag |
| `O` | Collapse to org |
| `B` | Back to dashboard |
| `Q` | Quit |
