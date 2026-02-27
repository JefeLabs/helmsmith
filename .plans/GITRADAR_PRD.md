# GitRadar — Product Requirements Document

**Version:** 1.0 Final
**Tool Name:** gitradar
**Config Location:** `~/.agentx/gitradar/`

---

## 1. Product Overview

### 1.1 Purpose

GitRadar is a terminal-based (TUI) analytics tool that visualizes git contribution data across multiple repositories, grouped by organization, team, and file type. It answers three questions at a glance:

1. **How much is each organization contributing?** (Team A vs Team B)
2. **What kind of work is each team doing?** (app code, tests, config, storybook)
3. **Who are the top performers and is each team operating at their typical pace?**

### 1.2 Key Concepts

| Concept | Description |
|---------|-------------|
| **Organization** | Top-level entity — e.g. "Team A" (core) or "Team B" (consultant) |
| **Team** | A group of individuals within an org — e.g. "Platform", "Frontend Squad" |
| **Member** | An individual contributor, matched by email/name/aliases |
| **Repo** | A git repository on disk |
| **Group** | Clusters repos by domain — web, backend, mobile, infra, data |
| **Tag** | Clusters teams by purpose — infrastructure, feature, analytics |
| **File Type** | Every changed file is classified: `app`, `test`, `config`, `storybook` |

### 1.3 Hierarchy

```
Organization (type: core | consultant)
  └── Team (tag: infrastructure | feature | analytics)
       └── Member (matched by email, name, aliases)

Repo (group: web | backend | mobile | shared | infra | data)
```

### 1.4 Technology Stack

```json
{
  "dependencies": {
    "@inquirer/prompts": "^8.2.0",
    "chalk": "^5.6.2",
    "commander": "^14.0.3",
    "js-yaml": "^4.1.1",
    "octokit": "^4.0.2",
    "ora": "^8.1.0",
    "simple-git": "^3.27.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.2.3",
    "tsup": "^8.5.1",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

---

## 2. File System Layout

### 2.1 Config & Data Directory

```
~/.agentx/gitradar/
├── config.yml                     # User-authored configuration
├── data/
│   ├── commits-by-filetype.json   # ★ Pre-aggregated contribution data
│   └── scan-state.json            # Per-repo incremental scan cursors
```

### 2.2 Source Code

```
src/
├── cli.ts                         # Entry point — commander setup
├── types/
│   └── schema.ts                  # Zod schemas for config + data files
├── config/
│   └── loader.ts                  # Reads & validates config.yml
├── store/
│   ├── commits-by-filetype.ts     # Read/write/merge aggregated records
│   ├── scan-state.ts              # Per-repo scan cursors
│   └── paths.ts                   # Resolves ~/.agentx/gitradar/ paths
├── collector/
│   ├── git.ts                     # simple-git → classify → aggregate → store
│   ├── classifier.ts              # File path → app|test|config|storybook
│   └── author-map.ts              # Author email/name → org/team/member resolution
├── aggregator/
│   ├── engine.ts                  # Roll up records by any dimension
│   ├── leaderboard.ts             # ★ Top performers computation
│   ├── trends.ts                  # Weekly trends + running averages
│   └── filters.ts                 # Filter by week/org/team/tag/group/member
├── ui/
│   ├── table.ts                   # ★ Custom table component
│   ├── grouped-hbar-chart.ts      # ★ Grouped stacked horizontal bar chart
│   ├── avg-output-chart.ts        # ★ Per-person average with ◈ marker
│   ├── line-chart.ts              # Multi-series line chart
│   ├── sparkline.ts               # Inline sparklines for table cells
│   ├── bar.ts                     # Inline stacked bar for table cells
│   ├── legend.ts                  # Shared legend renderer
│   ├── banner.ts                  # Header/title rendering
│   └── format.ts                  # Numbers, colors, ANSI-aware padding
├── views/
│   ├── dashboard.ts               # ★ Entry screen
│   ├── team-detail.ts             # One team drill-down
│   ├── member-detail.ts           # One person drill-down
│   ├── trends.ts                  # Full-screen trends
│   └── navigator.ts               # View stack + inquirer menu loop
└── __tests__/
    ├── classifier.test.ts
    ├── commits-by-filetype.test.ts
    ├── engine.test.ts
    ├── leaderboard.test.ts
    ├── grouped-hbar-chart.test.ts
    ├── avg-output-chart.test.ts
    ├── table.test.ts
    └── sparkline.test.ts
```

---

## 3. Configuration

### 3.1 `config.yml` — Full Example

```yaml
# ~/.agentx/gitradar/config.yml

repos:
  - path: ~/code/frontend-app
    name: frontend-app
    group: web
  - path: ~/code/api-server
    name: api-server
    group: backend
  - path: ~/code/mobile-ios
    name: mobile-ios
    group: mobile
  - path: ~/code/mobile-android
    name: mobile-android
    group: mobile
  - path: ~/code/shared-lib
    name: shared-lib
    group: shared
  - path: ~/code/infra-config
    name: infra-config
    group: infra
  - path: ~/code/design-system
    name: design-system
    group: web
  - path: ~/code/data-pipeline
    name: data-pipeline
    group: data

groups:
  web:      { label: Web }
  backend:  { label: Backend }
  mobile:   { label: Mobile }
  shared:   { label: Shared Libraries }
  infra:    { label: Infrastructure }
  data:     { label: Data }

orgs:
  - name: Team A
    type: core
    teams:
      - name: Platform
        tag: infrastructure
        members:
          - name: Alice Chen
            email: alice@company.com
            aliases: [alice.chen]
          - name: Bob Kumar
            email: bob@company.com
          - name: Carol Smith
            email: carol@company.com
          - name: Dave Lee
            email: dave@company.com

      - name: Product
        tag: feature
        members:
          - name: Eva Jones
            email: eva@company.com
          - name: Frank Wu
            email: frank@company.com
          - name: Grace Kim
            email: grace@company.com
          - name: Henry Park
            email: henry@company.com

      - name: Mobile
        tag: feature
        members:
          - name: Iris Zhang
            email: iris@company.com
          - name: Jake Brown
            email: jake@company.com
          - name: Kate Davis
            email: kate@company.com

  - name: Team B
    type: consultant
    teams:
      - name: Frontend Squad
        tag: feature
        members:
          - name: Leo Garcia
            email: leo@Team B.com
          - name: Mia Wilson
            email: mia@Team B.com

      - name: Data Squad
        tag: analytics
        members:
          - name: Noah Taylor
            email: noah@Team B.com
          - name: Olivia Martinez
            email: olivia@Team B.com
          - name: Pete Anderson
            email: pete@Team B.com

tags:
  infrastructure: { label: Infra }
  feature:        { label: Feature }
  analytics:      { label: Analytics }

settings:
  weeks_back: 12
  staleness_minutes: 60
```

### 3.2 Config Zod Schema

```ts
const MemberSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  aliases: z.array(z.string()).optional().default([]),
});

const TeamSchema = z.object({
  name: z.string(),
  tag: z.string().optional().default("default"),
  members: z.array(MemberSchema),
});

const OrgSchema = z.object({
  name: z.string(),
  type: z.enum(["core", "consultant"]),
  teams: z.array(TeamSchema),
});

const RepoSchema = z.object({
  path: z.string(),
  name: z.string().optional(),
  group: z.string().optional().default("default"),
});

const ConfigSchema = z.object({
  repos: z.array(RepoSchema),
  orgs: z.array(OrgSchema),
  groups: z.record(z.string(), z.object({ label: z.string().optional() })).optional().default({}),
  tags: z.record(z.string(), z.object({ label: z.string().optional() })).optional().default({}),
  settings: z.object({
    weeks_back: z.number().default(12),
    staleness_minutes: z.number().default(60),
  }).optional().default({}),
});
```

### 3.3 Config Loader Behavior

- Searches for config at `~/.agentx/gitradar/config.yml`
- `--config <path>` overrides
- Resolves `~` and relative repo paths against config file location
- Validates with zod — hard error on invalid config
- Warns (does not crash) if a repo path doesn't exist on disk

---

## 4. Data Storage

### 4.1 `commits-by-filetype.json` — Core Data File

Pre-aggregated to the grain of **member × week × repo × filetype**. This is the only data file the views consume.

```ts
interface UserWeekRepoRecord {
  // ── Identity ──
  member: string;                // "Alice Chen"
  email: string;                 // "alice@company.com"
  org: string;                   // "Team A"
  orgType: "core" | "consultant";
  team: string;                  // "Platform"
  tag: string;                   // "infrastructure"

  // ── Dimensions ──
  week: string;                  // "2026-W08"
  repo: string;                  // "frontend-app"
  group: string;                 // "web"

  // ── Metrics ──
  commits: number;
  activeDays: number;

  // ── File type breakdown ──
  filetype: {
    app:       { files: number; insertions: number; deletions: number };
    test:      { files: number; insertions: number; deletions: number };
    config:    { files: number; insertions: number; deletions: number };
    storybook: { files: number; insertions: number; deletions: number };
  };
}

interface CommitsByFiletype {
  version: 1;
  lastUpdated: string;           // ISO datetime
  records: UserWeekRepoRecord[];
}
```

**Why this grain:** It is the lowest grain any view needs. Every screen rolls up from here — dashboard groups by org, team detail groups by member, trends group by week. No view needs individual commit records. For 16 people × 12 weeks × 8 repos the ceiling is ~1,536 records. Realistically ~500–800. Loads instantly.

### 4.2 `scan-state.json` — Incremental Scan Cursors

Separate from the data file so scan state can be reset without losing aggregated data.

```ts
interface ScanState {
  version: 1;
  repos: Record<string, {
    lastHash: string;            // most recent commit hash seen
    lastScanDate: string;        // ISO datetime of last scan
    recentHashes: string[];      // rolling ~500 for dedup
    recordCount: number;         // aggregated records held for this repo
  }>;
}
```

### 4.3 Incremental Scan Flow

```
For each repo in config:
  1. Read scan-state → get lastScanDate
  2. If within staleness window → skip ("· frontend-app: fresh (12m ago)")
  3. git log --since=(lastScanDate - 1 day) --numstat --no-merges
  4. For each commit:
     a. Resolve author → org/team/member (skip unmatched)
     b. Classify each changed file → app|test|config|storybook
     c. Accumulate into Map<"member::week::repo", partial aggregate>
  5. Dedup: skip any commit whose hash is in scan-state.recentHashes
  6. Merge aggregated deltas into commits-by-filetype.json
  7. Update scan-state (lastHash, lastScanDate, rotate recentHashes)
  8. Atomic save both files (write .tmp then rename)
```

**Dedup strategy:** Since individual commit hashes are lost during aggregation, `scan-state.json` keeps a rolling set of ~500 recent hashes per repo. The 1-day overlap on incremental fetch ensures no gaps. The hash set ensures no double-counting.

### 4.4 Store Size Management

- Auto-prune on save if > 50MB or > 100K records (drop records beyond `weeks_back`)
- Manual: `--prune <days>` drops records older than N days
- `--reset` deletes both data files and starts fresh
- Expected size: ~500–2,000 records ≈ 0.5–2MB JSON

---

## 5. File Type Classifier

### 5.1 Classification Rules

Ordered rule list. First match wins.

| Priority | Category | Patterns |
|----------|----------|----------|
| 1 | `storybook` | `.stories.*`, `.story.*`, `.storybook/`, `.mdx` (in storybook paths) |
| 2 | `test` | `.test.*`, `.spec.*`, `.cy.*`, `.e2e.*`, `__tests__/`, `/tests?/`, `vitest.config`, `jest.config`, `cypress/`, `playwright/` |
| 3 | `config` | `.config.*`, `*.json`, `*.yml`, `*.yaml`, `*.toml`, `*.env*`, `Dockerfile`, `docker-compose`, `.github/`, `*.lock`, `Makefile`, `.eslintrc`, `.prettier*`, `tsconfig*`, `webpack.config`, `vite.config` |
| 4 | `app` | Everything else — `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.css`, `.scss`, `.html`, `.md`, `.sql`, `.graphql`, etc. |

**Order matters:** `.stories.test.tsx` → storybook (not test).

### 5.2 Visual Encoding

Consistent everywhere — charts, table cells, legends.

| File Type | Char | Color | Chalk |
|-----------|------|-------|-------|
| app | `█` | green | `chalk.green` |
| test | `▓` | blue | `chalk.blue` |
| config | `░` | yellow | `chalk.yellow` |
| storybook | `▒` | magenta | `chalk.magenta` |

---

## 6. Dashboard View — Entry Screen

The dashboard has three sections stacked vertically.

### 6.1 Section 1: Team Contribution by Week

Grouped stacked horizontal bar chart at the **organization level** by default. Each bar is one line of colored text.

```
Team Contribution by Week                              ■ app  ■ test  ■ config  ■ storybook
                                                                                lines changed
W10 ┤ Team A  ██████████████████████████████████████▓▓▓▓▓▓▓▓▓▓▓░░░░░▒▒     15.1K
    │ Team B      █████████████████▓▓▓▓▓░░░▒                                    4.4K
    │
W11 ┤ Team A  ████████████████████████████████████████████▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░▒▒  17.2K
    │ Team B      ██████████████████▓▓▓▓▓▓░░░▒                                  4.9K
    │
W12 ┤ Team A  ██████████████████████████████████████████▓▓▓▓▓▓▓▓▓▓▓░░░░░▒▒  17.0K
    │ Team B      ████████████████████▓▓▓▓▓▓░░░░▒                               5.3K
    ┤
    └────────────────┴────────────────────────────────────┴────────────────────┤
    0                5K                                   12K                 20K
```

**Expand modes** (re-renders in place, does not push a view):

| Mode | Bars per week | Triggered by |
|------|---------------|-------------|
| `org` (default) | 2 — Team A, Team B | `[o]` or startup |
| `team` | 5 — Platform, Product, Mobile │ Frontend Squad, Data Squad | `[e]` |
| `tag` | 3 — feature, infrastructure, analytics | `[g]` |

When expanded by team, a dashed separator visually splits core from consultant teams:

```
W12 ┤ ★ Platform      ████████████████████▓▓▓▓▓▓░░░▒                               5.2K
    │ ★ Product       ████████████████████████████████▓▓▓▓▓▓▓▓▓░░░░▒▒              8.9K
    │ ★ Mobile        ████████████▓▓▓▓░░                                            2.9K
    │                 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
    │ ◆ Front.Squad   █████████████▓▓░░▒                                            2.8K
    │ ◆ Data Squad    ██████████▓▓▓▓░░░▒                                            2.5K
```

**Weeks shown:** Dashboard shows the last 3 weeks (adapts to terminal height, caps at 4). Full 12-week history is in the trends view.

```ts
weeksToShow = min(4, max(2, floor((termRows - 30) / (barsPerGroup + 1))))
```

### 6.2 Section 2: Avg Output per Person

Per-team horizontal bars showing **lines changed ÷ headcount** for the current week, with a `◈` marker at the 3-month running average.

```
Avg Output per Person (W12)                            ■ app  ■ test  ■ config  ■ storybook
                                                  this week avg      3mo avg
                                                       ↓                ↓         avg/person
  Platform    (4)  ████████████████▓▓▓▓▓░░░▒     │    ◈                           1.3K
  Product     (4)  ██████████████████████▓▓▓▓▓░▒ │          ◈                     1.7K
  Mobile      (3)  ████████████▓▓▓░░             │  ◈                             1.0K
  Front.Squad (2)  █████████████▓▓░░▒            │     ◈                          1.4K
  Data Squad  (3)  ████████▓▓▓▓░░░▒              │ ◈                              0.8K
                                                  └── ◈ = 3-month running avg per person
```

**Reading the chart:**
- Bar extends **past** `◈` → above-average week (good)
- Bar stops **short** of `◈` → below-average week
- The `◈` marker sits in the same horizontal space as the bars, rendered as `chalk.white.bold("◈")`

**Running average computation:**
```ts
runningAvg = totalLinesInWindow / headcount / weeksInWindow
// window = last 12 weeks (3 months)
// headcount = distinct active members in that window
```

### 6.3 Section 3: Top Performers (Last 4 Weeks)

A 4-column leaderboard showing the top 5 contributors by file type and overall.

```
Top Performers (W09 → W12)                                           ■ app ■ test ■ cfg ■ sb
                                                                                   4-week total
 Overall                │  App Code             │  Test Code           │  Config
 ───────────────────────┤────────────────────────┤──────────────────────┤─────────────────────
 1. Eva Jones       6.8K│  1. Eva Jones      5.2K│  1. Alice Chen   1.8K│  1. Dave Lee     920
    Product   ████▓░    │     Product   █████   │     Platform  ▓▓▓▓  │     Platform  ░░░
 2. Alice Chen      5.9K│  2. Frank Wu       4.1K│  2. Bob Kumar    1.4K│  2. Noah Taylor  810
    Platform  ████▓░░   │     Product   ████    │     Platform  ▓▓▓   │     Data Sqd  ░░░
 3. Frank Wu        5.4K│  3. Alice Chen     3.4K│  3. Leo Garcia   1.2K│  3. Carol Smith  680
    Product   ████▓     │     Platform  ███     │     Front.Sq  ▓▓▓   │     Platform  ░░
 4. Leo Garcia      4.7K│  4. Leo Garcia     3.2K│  4. Grace Kim    1.1K│  4. Pete Anderson580
    Front.Sq  ████▓░    │     Front.Sq  ███     │     Product   ▓▓    │     Data Sqd  ░░
 5. Bob Kumar       4.2K│  5. Iris Zhang     2.8K│  5. Mia Wilson   980 │  5. Eva Jones    540
    Platform  ███▓░     │     Mobile    ███     │     Front.Sq  ▓▓    │     Product   ░░
```

**Columns:**

| Column | Metric | What it answers |
|--------|--------|-----------------|
| Overall | Total lines changed (all file types) | Who's producing the most overall? |
| App Code | Lines changed in `app` files | Who's writing feature/product code? |
| Test Code | Lines changed in `test` files | Who's investing in quality? |
| Config | Lines changed in `config` files | Who's doing infra/tooling work? |

**Each entry shows:** rank, member name, 4-week total value, team name, mini stacked bar (file-type breakdown for Overall column, single-color relative bar for category columns).

**Why 4 weeks:** Single-week leaderboards are noisy (vacation, one big merge). 4 weeks smooths spikes, shows sustained contribution, stays recent enough to feel current.

**Why 4 parallel columns:** Different people excel in different areas. A test-focused engineer might never top the Overall board but dominates Test. Showing all four respects all contribution types equally.

### 6.4 Dashboard Menu

```
[e] Expand by team  [g] Expand by tag  [o] Collapse to org
[↑↓] Select → drill into team
[t] Trends  [w] Change week  [r] Rescan  [q] Quit
```

Expand re-renders in place (only the bar chart and its legend change). The avg output chart and top performers always show all teams/individuals across all orgs regardless of expand mode.

### 6.5 Dashboard Height Budget

```
Banner:              3 rows
Bar chart:           (bars + 1 blank) × weeksShown + 3 (axis + legend) ≈ 12 rows
Avg output chart:    teams + 2 (header + legend) ≈ 7 rows
Separator:           1 row
Top performers:      header + 5 entries × 2 lines each ≈ 12 rows
Menu:                2 rows
Total:               ~37 rows → fits standard 40+ row terminal
```

---

## 7. Team Detail View

Pushed when the user selects a team from the dashboard.

```
◀ Back

PLATFORM · Team A · infrastructure                W01 → W12

File Type by Member (W12)                 ■ app  ■ test  ■ config  ■ storybook
                                                                  ◈ = 3mo avg
  Alice Chen  ██████████████████▓▓▓▓▓▓░░░▒     ◈                    1.2K
  Bob Kumar   ███████████████▓▓▓▓▓░░▒       ◈                       0.9K
  Carol Smith █████████████▓▓▓░░              ◈                      0.8K
  Dave Lee    ██████████▓▓░░             ◈                           0.6K

Member Activity (12 weeks)                ── Alice ── Bob ── Carol ── Dave
(line chart: one series per member, 8 rows)

Members (W12)
 Name         Commits  +Ins    -Del    Net     Breakdown        Δ prev
 ───────────  ───────  ──────  ──────  ──────  ───────────────  ──────
 Alice Chen        42   2.1K    1.2K    +900   ████████▓░░░░░░  ▲ 14%
 Bob Kumar         38   1.8K    1.0K    +800   ██████▓▓▓░░░░░░  ▲  6%
 Carol Smith       28   1.5K    1.1K    +400   █████▓▓░░░░░░░░  ▼  3%
 Dave Lee          20   1.1K    0.9K    +200   ████▓▓░░░░░░░░░  ▲  9%

Repos (W12)
 Repo             Commits  +Ins    -Del    Top Contributor    Group
 ──────────────   ───────  ──────  ──────  ─────────────────  ─────
 infra-config          52   2.8K    1.4K   Alice Chen         infra
 api-server            34   1.6K    1.2K   Bob Kumar          backend

[↑↓] Select member  [b] Back  [q] Quit
```

**Sections:**
1. Horizontal bars — per-member output with `◈` running average marker
2. Line chart — member activity over 12 weeks
3. Summary table — member stats for current week
4. Repo table — which repos this team touched

---

## 8. Member Detail View

Pushed when the user selects a member from the team detail.

```
◀ Back to Platform

ALICE CHEN · Platform · Team A                    W01 → W12

File Type by Week                         ■ app  ■ test  ■ config  ■ storybook
  W10  ██████████████████▓▓▓▓▓░░░▒                                    1.1K
  W11  █████████████████████▓▓▓▓▓▓░░░▒                                1.3K
  W12  ████████████████████▓▓▓▓▓▓░░░▒                                 1.2K

Activity (12 weeks)                       ── commits ── +lines ── net
(line chart: 3 series, 8 rows)

Repos (W12)
 Repo             Commits  +Ins    -Del    Breakdown        Δ prev
 ──────────────   ───────  ──────  ──────  ───────────────  ──────
 infra-config          18    820     410   ██▓▓▓▓▓░░░░░░░░  ▲ 22%
 api-server            14    680     420   ████████▓░░░░░░░  ▲  8%
 shared-lib             6    380     210   ██████▓▓░░░░░░░░  ─  0%
 frontend-app           4    220     160   █████████▓░░░░░░  new

12w Summary:  avg 8.2 commits/wk · 620 +lines/wk · 28% test ratio

[b] Back  [q] Quit
```

**Sections:**
1. Horizontal bars — grouped by week (last 3), one bar per week showing file-type trend
2. Line chart — commits, +lines, net over 12 weeks
3. Repo table — per-repo breakdown for current week
4. Summary line — 12-week averages

---

## 9. Trends View

Pushed from `[t]` on the dashboard. Full-screen deep dive.

```
TRENDS — All Orgs                                        W01 → W12

Commits/week                              ── Team A ·· Team B
(line chart: 2 org series, solid/dotted, 12 rows)

File Type Breakdown — 12 Weeks            ■ app  ■ test  ■ config  ■ storybook
W01 ┤ Team A  █████████████████████████████▓▓▓▓▓▓▓▓░░░░▒▒     12.8K
    │ Team B      ████████████▓▓▓▓░░▒                               3.1K
    ...
W12 ┤ Team A  ██████████████████████████████████████████▓▓▓▓▓▓▓▓▓░░░░░▒▒  17.0K
    │ Team B      ████████████████████▓▓▓▓▓▓░░░░▒                   5.3K

Avg Output per Person (12w sparklines)    ◈ = 3-month running avg
  Platform     ▁▂▃▃▅▅▇▅▃▅▇█  avg: 1.3K/person/wk  ◈ 1.1K
  Product      ▂▃▅▅▇▅▃▅▇█▇▅  avg: 1.7K/person/wk  ◈ 1.5K
  Mobile       ▁▃▃▅▅▇▅▃▅▅▃▃  avg: 1.0K/person/wk  ◈ 1.0K
  Front.Squad  ▃▅▅▇▇▅▃▅▇█▇▅  avg: 1.4K/person/wk  ◈ 1.2K
  Data Squad   ▁▂▃▅▃▅▅▇▅▃▃▅  avg: 0.8K/person/wk  ◈ 0.8K

Test Ratio:    34% ▁▂▃▃▅▅▇▅▃▅▇█   trending up ▲

[e] Expand by team  [g] Expand by tag  [f] Filter  [b] Back  [q] Quit
```

**Sections:**
1. Line chart — commits/week for all orgs (or teams/tags if expanded), 12 rows tall
2. Grouped horizontal bars — full 12-week file-type breakdown
3. Avg output sparklines — per-team 12-week sparkline with running average
4. Test ratio — overall test-to-app ratio trend

---

## 10. Navigation

### 10.1 View Stack

```ts
type NavigationAction =
  | { type: "push"; view: ViewFn }
  | { type: "pop" }
  | { type: "replace"; view: ViewFn }
  | { type: "quit" };

// Main loop
while (stack.length > 0) {
  const action = await stack[stack.length - 1](ctx);
  switch (action.type) {
    case "push": stack.push(action.view); break;
    case "pop": stack.pop(); break;
    case "replace": stack[stack.length - 1] = action.view; break;
    case "quit": return;
  }
}
```

### 10.2 Navigation Map

```
Dashboard (org level)
├── [e] Expand by team → re-render in place
├── [g] Expand by tag  → re-render in place
├── [o] Collapse to org → re-render in place
├── [↑↓] Select org/team → push Team Detail
│   └── [↑↓] Select member → push Member Detail
│       └── [b] Back → pop to Team Detail
│   └── [b] Back → pop to Dashboard
├── [t] Trends → push Trends
│   └── [b] Back → pop to Dashboard
├── [w] Change week → re-render in place
├── [r] Rescan → incremental fetch, re-render
└── [q] Quit
```

Expand by team/tag **does not push a view**. Only selecting a specific team or member pushes.

### 10.3 Render Model

Each view is a pure function: `(ctx: ViewContext) → Promise<NavigationAction>`. Views `console.clear()`, print output, present an `@inquirer/prompts` select menu, and return an action. No reactive state, no incremental re-rendering.

---

## 11. UI Components

### 11.1 Grouped Stacked Horizontal Bar Chart — `ui/grouped-hbar-chart.ts`

```ts
interface HBar {
  label: string;                    // "★ Platform", "◆ FrontendCo", "Team A"
  orgType?: "core" | "consultant";
  segments: { key: string; value: number }[];
  total: number;
}

interface HBarGroup {
  groupLabel: string;               // "W10", "W11", "W12"
  bars: HBar[];
  separatorAfter?: number[];        // dashed line after these bar indices
}

interface GroupedHBarChartOptions {
  groups: HBarGroup[];
  segmentDefs: { key: string; label: string; char: string; color: (s: string) => string }[];
  labelWidth?: number;
  maxBarWidth?: number;
  showValues?: boolean;             // total value right of bar
  showXAxis?: boolean;              // scale ticks below
  showLegend?: boolean;
  maxWidth?: number;                // terminal width
}

function renderGroupedHBarChart(options: GroupedHBarChartOptions): string
```

**Rendering:** Each bar = one row of colored chars. `globalMax` across all bars sets the scale. Each segment gets `round(value * scale)` characters (minimum 1 if value > 0). Value label (e.g., "5.2K") printed right of bar in dim.

**Reuse across views:**

| View | Groups | Bars per group |
|------|--------|---------------|
| Dashboard (org) | last 3 weeks | 1 per org |
| Dashboard (team) | last 3 weeks | 1 per team, separator between core/consultant |
| Dashboard (tag) | last 3 weeks | 1 per tag |
| Team detail | current week | 1 per member |
| Member detail | last 3 weeks | 1 per week |
| Trends | all 12 weeks | 1 per org/team/tag |

### 11.2 Avg Output Chart — `ui/avg-output-chart.ts`

```ts
interface AvgOutputBar {
  label: string;                    // "Platform"
  headcount: number;                // shown as "(4)"
  segments: { key: string; value: number }[];
  total: number;                    // this week's per-person avg
  runningAvg: number;               // 3-month per-person avg
}

interface AvgOutputChartOptions {
  bars: AvgOutputBar[];
  segmentDefs: SegmentDef[];
  labelWidth?: number;
  maxBarWidth?: number;
  showValues?: boolean;
  markerChar?: string;              // default: "◈"
  maxWidth?: number;
}

function renderAvgOutputChart(options: AvgOutputChartOptions): string
```

**Rendering:** Same as hbar rendering, but after each bar a `◈` marker is placed at `round(runningAvg * scale)` using the same horizontal axis.

### 11.3 Custom Table — `ui/table.ts`

```ts
interface Column {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: number;                   // fixed
  minWidth?: number;
  flex?: number;                    // weight for remaining space
  format?: (value: any, row: Record<string, any>) => string;
  headerColor?: (s: string) => string;
}

interface TableOptions {
  columns: Column[];
  rows: Record<string, any>[];
  compact?: boolean;
  footerRows?: Record<string, any>[];
  highlightRow?: number;
  maxWidth?: number;
  borderStyle?: "rounded" | "minimal" | "none";
  zebra?: boolean;
  groupSeparator?: number[];        // insert separator after these row indices
}

function renderTable(options: TableOptions): string
```

**Why custom:** cli-table3 can't do ANSI-aware width calculation with embedded sparklines and stacked bars. This table uses `stripAnsi()` for all width math.

**Column sizing:**
1. Assign fixed widths where `width` is set
2. Assign `minWidth` floors
3. Distribute remaining space to `flex` columns proportionally
4. Clamp, truncate with ellipsis if needed

### 11.4 Line Chart — `ui/line-chart.ts`

```ts
interface LineSeries {
  label: string;
  color: (s: string) => string;
  values: number[];
  style?: "solid" | "dotted";      // core = solid, consultant = dotted
}

interface LineChartOptions {
  series: LineSeries[];
  xLabels: string[];
  height?: number;                  // default: 10
  width?: number;
  yLabel?: string;
  showLegend?: boolean;
  yAxisWidth?: number;
}

function renderLineChart(options: LineChartOptions): string
```

**Line characters:** Solid: `─ ╭ ╮ ╰ ╯ │`. Dotted: `· ·` (spaced dots).

Used in: trends view (org/team velocity), team detail (member activity), member detail (commits/lines/net).

### 11.5 Sparkline — `ui/sparkline.ts`

```ts
function sparkline(values: number[], options?: {
  color?: (s: string) => string;
}): string
// → "▁▂▃▅▇▅▃▅▇█▇▅"
```

### 11.6 Inline Stacked Bar — `ui/bar.ts`

```ts
function stackedBar(segments: {
  value: number; color: (s: string) => string; char: string;
}[], width: number): string
// → "████████▓▓░░░░"
```

### 11.7 Legend — `ui/legend.ts`

```ts
function renderLegend(items: {
  label: string; color: (s: string) => string; char?: string;
}[], options?: { inline?: boolean }): string
// File types: "■ app  ■ test  ■ config  ■ storybook"
// Teams:      "── Platform ── Product ·· FrontendCo ·· DataWorks"
```

### 11.8 Format Utilities — `ui/format.ts`

```ts
fmt(n)              // 1234 → "1.2K", 1234567 → "1.2M"
delta(curr, prev)   // chalk.green("▲ 12%") or chalk.red("▼ 8%")
weekLabel(w)        // "2026-W08" → "Feb 17"
weekShort(w)        // "2026-W08" → "W08"
stripAnsi(s)        // remove ANSI escape codes for width calculation
padRight(s, n)      // ANSI-aware right pad
padLeft(s, n)       // ANSI-aware left pad
```

### 11.9 Banner — `ui/banner.ts`

```ts
function renderBanner(options: {
  title: string; subtitle?: string; right?: string; rightSub?: string;
}): string
```

---

## 12. Aggregation Engine

### 12.1 Core Rollup

```ts
interface RolledUp {
  commits: number;
  insertions: number;
  deletions: number;
  netLines: number;
  filesChanged: number;
  activeDays: number;
  activeMembers: number;
  filetype: {
    app:       { files: number; insertions: number; deletions: number };
    test:      { files: number; insertions: number; deletions: number };
    config:    { files: number; insertions: number; deletions: number };
    storybook: { files: number; insertions: number; deletions: number };
  };
}

function rollup(
  records: UserWeekRepoRecord[],
  groupBy: (r: UserWeekRepoRecord) => string
): Map<string, RolledUp>
```

### 12.2 Leaderboard — `aggregator/leaderboard.ts`

```ts
interface LeaderboardEntry {
  rank: number;
  member: string;
  team: string;
  org: string;
  orgType: "core" | "consultant";
  value: number;
  filetype: { app: number; test: number; config: number; storybook: number };
}

interface LeaderboardColumn {
  title: string;
  metric: "all" | "app" | "test" | "config" | "storybook";
  entries: LeaderboardEntry[];
}

function computeLeaderboard(
  records: UserWeekRepoRecord[],
  weeks: string[],              // last 4 weeks
  topN: number,                 // 5
): LeaderboardColumn[]
```

Steps:
1. Filter records to the 4-week window
2. Rollup by member → per-member totals with filetype breakdown
3. For each category (all, app, test, config): sort descending, take top N
4. Return 4 columns

### 12.3 Running Average

```ts
function computeRunningAvg(
  records: UserWeekRepoRecord[],
  team: string,
  currentWeek: string,
  windowWeeks: number,           // 12
): number
// Returns: avg lines changed per person per week over the window
```

### 12.4 Trends

```ts
interface TrendPoint {
  week: string;
  weekLabel: string;
  commits: number;
  insertions: number;
  deletions: number;
  netLines: number;
  app: number;
  test: number;
  config: number;
  storybook: number;
  testRatio: number;
}

function computeTrend(
  records: UserWeekRepoRecord[],
  filters?: { org?: string; team?: string; tag?: string; member?: string; group?: string }
): TrendPoint[]
```

### 12.5 Deltas

```ts
interface Delta {
  value: number;
  prev: number;
  pctChange: number | null;       // null if prev is 0
  direction: "up" | "down" | "flat";
}

function computeDeltas(current: RolledUp, previous: RolledUp): Record<string, Delta>
```

---

## 13. CLI Interface

```
gitradar [command] [options]

Commands:
  (default)              Interactive dashboard (org level)
  scan                   Scan repos and exit (no TUI)
  trends                 Jump directly to trends view
  init                   Create config.yml interactively

Options:
  -c, --config <path>    Config file (default: ~/.agentx/gitradar/config.yml)
  -w, --weeks <n>        Weeks of history (default: config or 12)
  -t, --team <name>      Filter to team
  --org <name>           Filter to organization
  --tag <tag>            Filter to tag
  --group <group>        Filter to repo group
  --demo                 Use generated demo data (no repos needed)
  --json                 Dump aggregated JSON to stdout

Store options:
  --force-scan           Full re-scan, ignore cursors
  --prune <days>         Remove records older than N days
  --store-stats          Print data file stats and exit
  --reset                Delete data files and start fresh
  --staleness <min>      Skip repo if scanned recently (default: config or 60)
```

### Startup Flow

```
1. Parse CLI args (commander)
2. Load ~/.agentx/gitradar/config.yml (or --config path)
3. Load scan-state.json + commits-by-filetype.json
4. Print: "Store: 847 records · 2 orgs · 5 teams · last scan: 3m ago"
5. For each repo in config:
   a. Check scan-state → lastScanDate
   b. If within staleness window → "· frontend-app: fresh (12m ago)"
   c. Otherwise:
      i.   git log --since=(lastScanDate - 1 day) --numstat --no-merges
      ii.  Filter out already-seen hashes
      iii. Classify files, resolve authors, aggregate by member×week×repo
      iv.  Merge aggregated deltas into commits-by-filetype.json
      v.   Update scan-state
      vi.  Print: "✓ frontend-app: +12 commits → 6 new records"
6. Atomic save both JSON files (write .tmp then rename)
7. Launch dashboard view
```

---

## 14. Implementation Order

| # | Files | Size | What | Dependencies |
|---|-------|------|------|-------------|
| 1 | `types/schema.ts` | S | Zod schemas — config, data, scan-state | — |
| 2 | `store/paths.ts` | S | `~/.agentx/gitradar/` path resolution | — |
| 3 | `collector/classifier.ts` + tests | S | File path → file type | 1 |
| 4 | `ui/format.ts` + `ui/legend.ts` | S | Number formatting, ANSI utils | — |
| 5 | **`ui/grouped-hbar-chart.ts` + tests** | **M** | **Primary dashboard chart** | 4 |
| 6 | **`ui/avg-output-chart.ts` + tests** | **M** | **Per-person avg with ◈ marker** | 4, 5 |
| 7 | `ui/sparkline.ts` + `ui/bar.ts` | S | Inline widgets for table cells | 4 |
| 8 | **`ui/table.ts` + tests** | **L** | **Custom table, ANSI-aware sizing** | 4 |
| 9 | `ui/line-chart.ts` + tests | L | Multi-series (trends + detail views) | 4 |
| 10 | `ui/banner.ts` | S | Header rendering | 4 |
| 11 | `config/loader.ts` | S | YAML load + zod validate | 1 |
| 12 | `store/scan-state.ts` | S | Per-repo cursors read/write | 1, 2 |
| 13 | **`store/commits-by-filetype.ts` + tests** | **M** | **Aggregated store + merge + dedup** | 1, 2 |
| 14 | `collector/author-map.ts` | S | Author → org/team/member resolution | 1 |
| 15 | `collector/git.ts` | M | simple-git → classify → aggregate → merge | 3, 13, 14 |
| 16 | `aggregator/engine.ts` + tests | M | Generic rollup | 1 |
| 17 | **`aggregator/leaderboard.ts` + tests** | **M** | **Top performers computation** | 16 |
| 18 | `aggregator/trends.ts` + `aggregator/filters.ts` | S | Trend series + deltas + running avg | 16 |
| 19 | **`views/dashboard.ts`** | **L** | **Bars + avg chart + top performers + expand** | 5, 6, 7, 16, 17, 18 |
| 20 | `views/team-detail.ts` | M | Member bars + line chart + tables | 5, 6, 8, 9 |
| 21 | `views/member-detail.ts` | S | Weekly bars + line chart + table | 5, 8, 9 |
| 22 | `views/trends.ts` | M | Line chart + full bars + avg sparklines | 5, 7, 9 |
| 23 | `views/navigator.ts` | M | View stack + inquirer menu loop | 19, 20, 21, 22 |
| 24 | `cli.ts` | S | Wire everything | 11, 12, 15, 23 |
| 25 | Demo data generator | S | `--demo` flag | 1 |

### Critical Path

**Steps 5, 6, 8, 13, 17, 19** — the two chart components, the table, the storage merge, the leaderboard computation, and the dashboard view. Everything else is straightforward plumbing.

---

## 15. Design Decisions

### Org-level dashboard default
Most stakeholders care about "core vs consultant" before individual teams. Team A vs Team B is the top-level question. Expanding to team or tag is one keypress away with in-place re-rendering.

### Horizontal bars for terminal
Each bar = one row of colored text. Terminal width gives 60+ chars of bar resolution. Team labels sit left, values right. Trivial to render, natural to read. The same component serves all 4 views with different data.

### Pre-aggregated storage
Storing raw commits (50K+) is wasteful. Aggregating to `member × week × repo` collapses to ~800 records. Loads in <10ms. Every view rolls up from this grain. No view needs commit-level data.

### Separate scan-state from data
Git cursors in one file, aggregated metrics in another. Can reset scan state (trigger full re-scan) without losing data, or prune old data without losing cursors.

### Top performers replaces summary table
The org-level summary (headcount, total commits, etc.) was passive information already visible in the bar chart. The leaderboard actively answers "who's driving output?" and respects all contribution types (app, test, config) with parallel columns.

### Per-person average with running average marker
Raw totals mislead — 4 people producing 5K isn't comparable to 2 people producing 3K. Normalizing by headcount + showing the `◈` running average marker instantly answers "is this team at their usual pace?" without needing to remember history.

### 4-week leaderboard window
Single weeks are noisy. 4 weeks smooths vacation/sprint-boundary artifacts. Recent enough to feel current. Shows sustained contribution, not one-off spikes.

### Expand re-renders in place
Switching org→team→tag grouping is a lens change, not a navigation event. The dashboard stays on screen — only the bar chart changes. This keeps the mental model simple.

### Atomic writes
Store saves write to `.tmp` then `fs.rename()`. Prevents corruption if the process is killed mid-write.

### No database
JSON files keep the tool zero-native-deps and human-inspectable. At ~1,000 records, `JSON.parse` + array filter is faster than SQLite overhead. If someone needs 100+ repos, SQLite can be added as an optional backend later.

---

## 16. Workspace-Based Repo Registry (`repos.yml`)

### 16.1 Problem

Repos, groups, and tags are currently embedded in `config.yml`. This creates three issues:

1. **No sharing** — peers must manually duplicate the repo list and taxonomy
2. **No cross-tool reuse** — other agentx tools that need the same repo registry can't access it
3. **No multi-department support** — users managing multiple departments have no way to organize separate sets of repos

### 16.2 Solution: `repos.yml` as a Standalone Registry

Repos, groups, and tags move to a dedicated file that lives at the **agentx level** (not the gitradar level). This file is shareable across peers and consumable by any agentx tool.

#### File Locations (resolution order)

| Priority | Path | Scope |
|----------|------|-------|
| 1 | `<git-root>/.agentx/repos.yml` | Project-level (checked into repo, shared with team) |
| 2 | `~/.agentx/repos.yml` | User-level (personal, all departments) |

Both files are loaded. Workspaces from both sources are presented to the user.

#### File Format

```yaml
# ~/.agentx/repos.yml
workspaces:
  engineering:
    label: Engineering
    repos:
      - name: frontend-app
        path: ~/code/frontend-app
        group: web
        tags: [feature]
      - name: api-server
        path: ~/code/api-server
        group: backend
        tags: [infrastructure]
      - name: mobile-ios
        path: ~/code/mobile-ios
        group: mobile
        tags: [feature]
      - name: shared-lib
        path: ~/code/shared-lib
        group: shared
        tags: [feature]

  data-dept:
    label: Data Department
    repos:
      - name: data-pipeline
        path: ~/code/data-pipeline
        group: data
        tags: [analytics]
      - name: ml-models
        path: ~/code/ml-models
        group: data
        tags: [analytics]

  client-acme:
    label: Acme Client
    repos:
      - name: acme-portal
        path: ~/code/acme/portal
        group: web
        tags: [feature]

groups:
  web:      { label: Web }
  backend:  { label: Backend }
  mobile:   { label: Mobile }
  shared:   { label: Shared Libraries }
  data:     { label: Data }

tags:
  feature:        { label: Feature }
  infrastructure: { label: Infra }
  analytics:      { label: Analytics }
```

### 16.3 Workspace Selection Flow

GitRadar is git-aware. On startup it detects whether the user is in a git project and discovers all available workspaces.

```
gitradar starts
    │
    ▼
Detect git root (simple-git, if in a git project)
    │
    ├── Load ~/.agentx/repos.yml              (global workspaces)
    ├── Load <git-root>/.agentx/repos.yml     (project workspaces, if exists)
    │
    ▼
Collect all workspaces from both sources
    │
    ├── --workspace flag given?          → use that, done
    ├── Only 1 workspace total?          → use it automatically, done
    └── Multiple workspaces?             → prompt user to pick
```

#### Workspace Selection Prompt

When multiple workspaces exist, the user is shown name, source path, and repo count:

```
Select workspace:

  Global (~/.agentx/repos.yml)
    1. engineering        (12 repos)
    2. data-dept          (4 repos)

  Project (/Users/you/code/acme/.agentx/repos.yml)
    3. client-acme        (3 repos)
    4. engineering        (6 repos)

> _
```

Same-name workspaces in global and project sources are **not merged** — they appear as separate choices. The user explicitly picks one.

#### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Not in a git project, no global `repos.yml` | Fall back to `config.yml` repos (backward compat) |
| Not in a git project, global `repos.yml` exists | Use global, prompt if multiple workspaces |
| In a git project, only project-level `repos.yml` | Use project, prompt if multiple workspaces |
| Both exist, same workspace name in both | Show both as separate entries with source path |
| `--demo` mode | Skip workspace selection entirely |
| `repos.yml` exists but `config.yml` still has `repos` | `repos.yml` workspace takes precedence; `config.yml` repos ignored with warning |

### 16.4 Impact on `config.yml`

When `repos.yml` is in use, `config.yml` shrinks to tool-specific concerns:

```yaml
# ~/.agentx/gitradar/config.yml
workspace: engineering          # optional: pre-select workspace (skip prompt)

orgs:
  - name: Acme Corp
    type: core
    teams:
      - name: Platform
        tag: infrastructure
        members:
          - name: Alice Chen
            email: alice@company.com

settings:
  weeks_back: 12
  staleness_minutes: 60
```

`repos`, `groups`, and `tags` are no longer needed in `config.yml` when `repos.yml` provides them. For backward compatibility, `config.yml` repos still work if no `repos.yml` exists.

### 16.5 New CLI Flags

| Flag | Description |
|------|-------------|
| `--workspace <name>` | Select workspace by name (skips prompt) |

### 16.6 Zod Schema for `repos.yml`

```ts
const WorkspaceRepoSchema = z.object({
  name: z.string(),
  path: z.string(),
  group: z.string().optional().default("default"),
  tags: z.array(z.string()).optional().default([]),
});

const WorkspaceSchema = z.object({
  label: z.string().optional(),
  repos: z.array(WorkspaceRepoSchema),
});

const ReposRegistrySchema = z.object({
  workspaces: z.record(z.string(), WorkspaceSchema),
  groups: z.record(z.string(), z.object({ label: z.string().optional() })).optional().default({}),
  tags: z.record(z.string(), z.object({ label: z.string().optional() })).optional().default({}),
});
```

### 16.7 Implementation Order

| # | Task | Size | Dependencies |
|---|------|------|-------------|
| 1 | Define `ReposRegistrySchema` in `types/schema.ts` | S | — |
| 2 | Create `src/config/repos-registry.ts` — load + validate `repos.yml` from both paths | M | 1 |
| 3 | Create `src/config/workspace-selector.ts` — discover workspaces, prompt if multiple | M | 2 |
| 4 | Add git-root detection to startup flow | S | — |
| 5 | Update `cli.ts` — add `--workspace` flag, integrate workspace selection before scan | M | 2, 3, 4 |
| 6 | Update config loader — merge workspace repos/groups/tags into Config object | M | 2, 5 |
| 7 | Backward compatibility — fall back to `config.yml` repos when no `repos.yml` exists | S | 6 |
| 8 | Tests for registry loading, workspace selection, git-root detection, backward compat | M | All above |

### 16.8 Import/Export Functionality

Enables sharing repo registries between peers without manual file editing.

#### Export Command

```bash
gitradar export
```

Interactive flow:
1. Show all available workspaces (global + project)
2. User selects which workspace to export
3. Output portable YAML to stdout (pipe to file)

Exported format **strips local paths** — only names, groups, and tags are portable:

```yaml
workspaces:
  engineering:
    label: Engineering
    repos:
      - name: frontend-app
        group: web
        tags: [feature]
      - name: api-server
        group: backend
        tags: [infrastructure]

groups:
  web:      { label: Web }
  backend:  { label: Backend }

tags:
  feature:        { label: Feature }
  infrastructure: { label: Infra }
```

#### Import Command

```bash
gitradar import <file>
```

Interactive flow:

1. **Destination**: User chooses where to save:
   ```
   Where to save?
     1. Global   (~/.agentx/repos.yml)
     2. Project  (/Users/you/code/acme/.agentx/repos.yml)
   > _
   ```

2. **Target workspace**: User picks existing workspace to merge into, or creates new:
   ```
   Target workspace:
     1. engineering        (existing — 12 repos, will merge)
     2. data-dept          (existing — 4 repos, will merge)
     3. [Create new workspace]
   > _
   ```

3. **Path prompting**: For each imported repo, prompt for local path:
   ```
   Importing 4 repos into "client-shared":
     frontend-app: path? ~/code/frontend-app
     api-server: path? ~/code/api-server
     mobile-ios: path? [skip]
     shared-lib: path? ~/libs/shared
   ```
   - Skipped repos are saved without a path (user can add later)
   - Existing repos (same name) get group/tags updated, path unchanged

4. **Result**: Merged into destination repos.yml
   ```
   ✓ Saved 3 repos to ~/.agentx/repos.yml (workspace: client-shared)
   ```

#### Merge behavior on import

| Scenario | Behavior |
|----------|----------|
| New repo name | Prompt for path, append to workspace |
| Existing repo name, same group/tags | Skip (no changes needed) |
| Existing repo name, different group/tags | Update group/tags, keep existing path |
| New groups/tags in imported file | Append to destination registry |
| Existing groups/tags in destination | Keep destination labels (no overwrite) |

#### Implementation Order

| # | Task | Size | Dependencies |
|---|------|------|-------------|
| 9 | Create `src/commands/export.ts` — workspace selection, path stripping, YAML output | M | 16.2 (registry loader) |
| 10 | Create `src/commands/import.ts` — file parsing, destination selection, workspace selection/creation, path prompting, merge logic | L | 16.2 (registry loader) |
| 11 | Register export/import as CLI subcommands in `cli.ts` | S | 9, 10 |
| 12 | Tests for export (strips paths, valid YAML output) and import (merge logic, path prompting, edge cases) | M | 9, 10 |
