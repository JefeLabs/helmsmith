# GitRadar Feature Tour

A walkthrough of every feature in the GitRadar TUI, organized by how you'd use them in a typical session.

---

## 1. CLI Entry Points

### Default: Interactive Dashboard

```bash
gitradar                           # launch the full TUI
gitradar --demo                    # use synthetic data (no repos needed)
gitradar --workspace my-workspace  # launch a specific workspace
```

### Scan Only

```bash
gitradar scan                      # scan repos, print results, exit (no TUI)
gitradar scan --force-scan         # full re-scan ignoring staleness
```

### Workspace Management

```bash
gitradar workspace create my-team --label "My Team"   # create workspace
gitradar workspace list                                # list workspaces
```

### Repo Management

```bash
gitradar repo list                    # list repos in current workspace
gitradar repo add ~/code/my-project   # discover and add repos from directory
gitradar repo remove frontend-app     # remove a repo
```

### Org & Author Management

```bash
gitradar org list                                          # list orgs and teams
gitradar org add --name "Acme" --type core --team Platform --tag infra
gitradar org add-team --name "Acme" --team Mobile --tag mobile

gitradar author list                                       # list discovered authors
gitradar author list --unassigned                          # show only unassigned
gitradar author assign alice@co.com --org Acme --team Platform
gitradar author bulk-assign --prefix CON --org ContractCo --team Squad
```

### View Commands (non-interactive)

```bash
gitradar view contributions --json              # JSON output
gitradar view contributions --group-by team     # group by team
gitradar view leaderboard -w 8                  # top performers, 8 weeks
gitradar view repo-activity                     # repo activity summary
gitradar view trends                            # jump to trends screen
```

### Data Management

```bash
gitradar data export                # portable YAML export (no local paths)
gitradar data export-csv            # CSV export to stdout
gitradar data export-csv -o out.csv # CSV export to file
gitradar data import backup.yml     # import workspace from YAML
gitradar data enrich                # pull PR metrics from GitHub API
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
| `--workspace <name>` | Select workspace |
| `--prune <weeks>` | Remove records older than N weeks |

---

## 2. Dashboard Tabs

The dashboard is the main screen. Four tabs are accessible via single-keypress hotkeys or Tab cycling.

### Tab C: Contributions

The default landing tab. Shows a **grouped stacked horizontal bar chart** of lines changed, with full drill-down, pivot, segmentation, and granularity controls.

#### Drill Levels

Navigate the org hierarchy with arrow keys:

- **↓** — Drill deeper: org → team → user
- **↑** — Drill up: user → team → org

At each level, entities are numbered (`1`-`9`) and you can press a number to jump into a team's detail view.

#### Granularity & Time Window

- **+/-** — Switch granularity: week → month → quarter → year (and back)
- **←/→** — Extend or shrink the time window (e.g., 12 weeks → 14 weeks, or 6 months → 4 months)

Each granularity has its own depth range. Weeks: 2–24, months: 2–12, quarters: 2–8, years: 1–5.

#### Modes & Toggles

- **T** — Toggle tag overlay (group by tag instead of org/team)
- **D** — Cycle detail modes: chart → lines detail (shows +ins, -del, test%, churn) → data table (tabular breakdown per group per bucket)
- **V** — Pivot: toggle between "by time" (time buckets as groups, entities as bars) and "by entity" (entities as groups, time buckets as bars)
- **U** — Toggle per-user mode: divides all metrics by headcount for fair cross-team comparison
- **S** — Segment menu: hide/show contributors by performance tier (top 20%, middle 60%, bottom 20%). When filtering at org/team drill level, segments are computed at the individual user level and excluded users' data is removed before aggregation
- **H** — Toggle unassigned author visibility (hidden by default)

#### Bar Encoding

Each bar is color-coded by file type:
- `█` green = app code
- `▓` blue = test code
- `░` yellow = config files
- `▒` magenta = storybook
- `▔` cyan = documentation

Core teams are prefixed with `★`, consultants with `◆`.

#### Columns

Bars are accompanied by data columns that adapt to the active detail layer:

- **Compact** (default): trend, net, cmts, days, hc
- **Lines** (D once): adds +ins, -del, tst%, churn
- **PRs** (when enrichment data exists): PRs, merged, cycle, reviews

Each value shows a trend indicator comparing the current period to its running average:
- `▲` green = above average
- `▼` red = below average
- `○` dim = within threshold

Strong indicators (colored background) appear when a value exceeds both its own average and the team average.

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

### Tab M: Manage

Full configuration management without leaving the TUI. Five sub-sections accessible via hotkeys:

#### Repos Section (R)

- **D** — Add repos: scan a directory path to discover git repos
- **↑↓** — Select a repo
- **⏎** — Collect (scan) the selected repo
- **S** — Collect all repos
- **X** — Remove the selected repo

#### Orgs Section (O)

- **N** — Create a new organization (prompts for name, type, team, tag)
- **+** — Add a team to an existing org
- **-** — Remove a team from an org (warns if authors are assigned, unassigns them)

#### Authors Section (A)

Shows all discovered authors from git history, grouped by assignment status.

- **↑↓** — Select an author
- **⏎** — Assign or move: pick org → pick team. Shows current assignment with `●` marker. Offers quick team change within same org.
- **U** — Unassign the selected author (with Y/N confirmation)
- **P** — Bulk assign by identifier prefix: assign all authors whose name, email, or identifier matches a prefix

#### Groups Section (G)

Shows repo groups and their member repos.

#### Tags Section (T)

Shows team tags and which teams use each tag.

#### Global Manage Actions

- **E** — Export workspace data as portable YAML
- **Q** — Quit

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

Full-screen historical analysis. Accessed from the CLI via `gitradar view trends`.

### Sections

1. **Commits/Week Line Chart (12 weeks)** — One series per org/team/tag, 12 rows tall
2. **File Type Breakdown (12 weeks)** — Full grouped horizontal bars for every week in the window
3. **Avg Output per Person (sparklines)** — Per-team sparkline using `▁▂▃▄▅▆▇█` characters, avg lines/person/week, and running average value
4. **Test Ratio Sparkline** — Per-team test ratio trend with direction indicator (up/flat/down)

---

## 6. File Classification

Every changed file in every commit is automatically classified:

| Category | Examples |
|----------|----------|
| **App** | `src/index.ts`, `lib/utils.py`, `components/Button.tsx` |
| **Test** | `*.test.ts`, `*.spec.js`, `__tests__/*`, `cypress/*`, `playwright/*` |
| **Config** | `*.json`, `*.yml`, `Dockerfile`, `.github/*`, `*.lock`, `tsconfig*` |
| **Storybook** | `*.stories.tsx`, `.storybook/*`, storybook `.mdx` files |
| **Doc** | `*.md`, `README*`, `LICENSE*`, `CHANGELOG*`, `docs/*` |

Classification priority: storybook > test > config > doc > app (first match wins).

---

## 7. Commit Intent Tracking

GitRadar parses conventional commit messages to extract semantic intent:

| Intent | Matched Prefixes |
|--------|-----------------|
| `feat` | `feat:`, `feature:` |
| `fix` | `fix:`, `bugfix:` |
| `refactor` | `refactor:` |
| `docs` | `docs:` |
| `test` | `test:` |
| `chore` | `chore:` |
| `other` | Anything else |

Additional metadata extracted:
- **Breaking changes** — Commits with `!` marker (e.g., `feat!: remove old API`)
- **Scopes** — Parenthesized scope (e.g., `fix(auth):` → scope "auth")

---

## 8. GitHub Enrichment

GitRadar can pull PR and review data from the GitHub API:

```bash
gitradar data enrich                # enrich all repos
gitradar data enrich -w 4           # enrich last 4 weeks only
```

### Enrichment Data

| Metric | Description |
|--------|-------------|
| PRs opened | Count of PRs opened by the member in the period |
| PRs merged | Count of merged PRs |
| PR branch types | Classification: feature, fix, bugfix, chore, hotfix, other |
| Avg cycle time | Average hours from PR open to merge |
| Reviews given | Count of PR reviews authored |
| Churn rate | Percentage of lines changed that were recently added |

Enrichment data appears automatically in the Contributions tab columns when available.

---

## 9. Incremental Scanning

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

## 10. Author Discovery & Assignment

GitRadar automatically discovers authors from git history and maintains an author registry.

### Discovery

Every git commit author (email + name) is recorded in the SQLite database with:
- First seen / last seen dates
- Repos seen in
- Total commit count
- Extracted identifier (e.g., "Edwin Cruz (CONEWC)" → identifier "CONEWC")

### Assignment

Authors can be assigned to orgs/teams via:
1. **Config members** — Directly listed in `config.yml` with email, name, aliases
2. **TUI Manage tab** — Interactive assign/move/unassign from the Authors section
3. **CLI commands** — `gitradar author assign` and `gitradar author bulk-assign`
4. **Identifier rules** — Orgs with an `identifier` prefix auto-match authors by their parenthesized code

### Reattribution

When author assignments change, records are reattributed on startup. The `reattributeRecords()` function re-resolves each record's org/team/tag using the current author map and registry, ensuring data always reflects the latest assignments.

---

## 11. Segment Filtering

Press **S** on the Contributions tab to access the segment menu. Segments classify contributors into three tiers based on total output:

| Segment | Default | Description |
|---------|---------|-------------|
| High | Top 20% | Highest-output contributors |
| Middle | 60% | Mid-range contributors |
| Low | Bottom 20% | Lowest-output contributors |

When hiding a segment at the org or team drill level, segments are computed at the **individual user level** — excluded users' records are removed before aggregation, so org/team bars show reduced totals rather than disappearing entirely.

Thresholds are configurable via `segment_high_pct` and `segment_low_pct` in settings.

---

## 12. Demo Mode

```bash
gitradar --demo
```

Generates a fully synthetic but reproducible dataset:

- **2 orgs**: Acme Corp (core), ContractCo (consultant)
- **5 teams**: Platform, Product, Mobile, Frontend Squad, Data Squad
- **16 members** with realistic contribution patterns
- **8 repos** across 6 groups (web, backend, mobile, shared, infra, data)
- **Team-to-repo affinity** — each team works primarily in 2-4 repos
- **Commit intent distribution** — realistic feat/fix/refactor/chore proportions
- **Breaking changes and scopes** — occasional breaking commits with varied scopes
- **Deterministic** — seeded PRNG produces identical data every run

Useful for evaluation, demos, and UI development without real repositories.

---

## 13. Configuration

Single YAML file at `~/.agentx/gitradar/config.yml`:

```yaml
repos:
  - path: ~/code/frontend-app
    name: frontend-app
    group: web

orgs:
  - name: Acme Corp
    type: core
    identifier: ACM        # optional: auto-assign authors with this prefix
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
  segment_high_pct: 20     # top segment threshold
  segment_low_pct: 20      # bottom segment threshold
  trend_threshold: 0.10    # 10% delta for trend indicators
```

Key configuration features:
- **Aliases** — Match commits from multiple email addresses or names to one person
- **Groups** — Categorize repos (web, backend, mobile, etc.)
- **Tags** — Cross-team categorization (infrastructure, feature, analytics)
- **Org types** — Distinguish `core` teams from `consultant` teams
- **Identifiers** — Auto-assign authors based on parenthesized codes in git names
- **Path resolution** — Supports `~` expansion and relative paths (resolved against config location)
- **Segment thresholds** — Customize the high/low percentile boundaries

---

## 14. Keyboard Reference

### Dashboard — Contributions Tab

| Key | Action |
|-----|--------|
| `↓` | Drill deeper (org → team → user) |
| `↑` | Drill up (user → team → org) |
| `T` | Toggle tag overlay |
| `+`/`-` | Finer/coarser granularity (week ↔ month ↔ quarter ↔ year) |
| `←`/`→` | Shrink/extend time window |
| `D` | Cycle detail mode: chart → lines → table |
| `V` | Pivot: by time ↔ by entity |
| `U` | Toggle per-user normalization |
| `S` | Segment filter menu (hide/show tiers) |
| `H` | Toggle unassigned author visibility |
| `1`-`9` | Drill into numbered team |
| `Tab` | Next tab |
| `Q` | Quit |

### Dashboard — Repo Activity Tab

| Key | Action |
|-----|--------|
| `1` | 4 weeks window |
| `2` | 8 weeks window |
| `3` | 3 months window |
| `Tab` | Next tab |
| `Q` | Quit |

### Dashboard — Top Performers Tab

| Key | Action |
|-----|--------|
| `1` | 4 weeks window |
| `2` | 8 weeks window |
| `3` | 3 months window |
| `Tab` | Next tab |
| `Q` | Quit |

### Dashboard — Manage Tab

| Key | Action |
|-----|--------|
| `R` | Repos section |
| `O` | Orgs section |
| `A` | Authors section |
| `G` | Groups section |
| `T` | Tags section |
| `↑`/`↓` | Select item |
| `⏎` | Action on selected (collect repo / assign author) |
| `D` | Add repos from directory |
| `S` | Collect all repos |
| `X` | Remove selected repo |
| `N` | New organization |
| `+` | Add team to org |
| `-` | Remove team from org |
| `U` | Unassign selected author |
| `P` | Bulk assign by prefix |
| `E` | Export workspace |
| `Tab` | Next tab |
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
