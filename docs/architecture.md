# GitRadar Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI (commander)                                                 │
│  src/cli.ts                                                      │
│  Parses args, orchestrates startup, applies filters              │
└───────┬──────────────────────────────────────────────────────────┘
        │
        ├──► Config Loader ──► Zod Validation ──► Config
        │    src/config/         src/types/
        │
        ├──► Collector ──► Store (JSON files)
        │    src/collector/      src/store/
        │
        ├──► Aggregator ──► Rollups, Trends, Leaderboards
        │    src/aggregator/
        │
        └──► Navigator ──► Views ──► UI Components ──► Terminal
             src/views/              src/ui/
```

## Layer Responsibilities

### CLI Layer (`src/cli.ts`)

The entry point. Uses `commander` to define four subcommands (`default`, `scan`, `trends`, `init`) and all global flags. Responsibilities:

- Parse and validate CLI arguments
- Handle early-exit paths (`--reset`, `--store-stats`, `--json`)
- Load config and store data
- Trigger repo scanning
- Apply filters (`--org`, `--team`, `--tag`, `--group`)
- Construct `ViewContext` and hand off to the navigator

The CLI layer has no knowledge of UI rendering or data aggregation logic.

### Config Layer (`src/config/loader.ts`)

Reads `config.yml`, expands paths, and validates against Zod schemas.

```
config.yml (YAML)
    │
    ▼
js-yaml.load()
    │
    ▼
Zod schema validation (src/types/schema.ts)
    │
    ▼
Config object (typed, validated, paths resolved)
```

Key design decisions:
- **Warn, don't crash** on missing repo paths — allows partial configs
- **Resolve relative paths** against the config file directory, not CWD
- **Expand `~`** in all path fields

### Collector Layer (`src/collector/`)

Responsible for extracting commit data from git repositories and transforming it into the canonical `UserWeekRepoRecord` format.

```
src/collector/
├── index.ts        # Scan coordinator — loops repos, manages staleness
├── git.ts          # Git log parser — runs git, parses output
├── classifier.ts   # File classifier — app/test/config/storybook
└── author-map.ts   # Author resolver — email/name/alias → member identity
```

#### Data Flow

```
git log --numstat --name-status
    │
    ▼
parseGitLogOutput()          → ParsedCommit[]
    │
    ▼
scanRepo()
  ├── resolve author (AuthorMap)   → skip if unknown
  ├── classify each file           → app | test | config | storybook
  ├── compute ISO week             → "2026-W08"
  ├── deduplicate (recentHashes)   → skip if seen
  └── accumulate by member::week::repo
    │
    ▼
UserWeekRepoRecord[]         → merged into store
```

#### Staleness and Incremental Scanning

The scan coordinator (`index.ts`) implements a cursor-based incremental strategy:

1. For each repo, check `lastScanDate` against `staleness_minutes`
2. If fresh → skip (print `· repo: fresh (Xm ago)`)
3. If stale → scan with `since = lastScanDate - 1 day` (1-day overlap for safety)
4. After scan → update `lastHash`, `lastScanDate`, rotate `recentHashes` (keep 500)

This means a typical session re-scans only repos with new commits.

### Store Layer (`src/store/`)

Flat-file JSON persistence. No database, no external services.

```
~/.agentx/gitradar/
├── config.yml                          # User configuration
└── data/
    ├── commits-by-filetype.json        # All UserWeekRepoRecords
    └── scan-state.json                 # Per-repo scan cursors
```

```
src/store/
├── paths.ts                # Path constants and ensureDataDir()
├── commits-by-filetype.ts  # Load, save, merge, prune records
└── scan-state.ts           # Load, save, update scan cursors
```

#### Merge Strategy

New records are merged with existing records by composite key `member::week::repo`:
- **Existing key** — sum all metrics (commits, insertions, deletions, files, active days capped at 7)
- **New key** — append as-is

This design supports overlap-safe incremental scans. Scanning the same commit twice won't double-count because metrics are summed by the same key.

#### Atomic Writes

Both store files use a write-to-temp-then-rename pattern to prevent corruption on crash:

```
data → JSON.stringify → write to .tmp file → fs.rename (atomic)
```

### Aggregator Layer (`src/aggregator/`)

Pure functions that transform flat records into view-ready structures.

```
src/aggregator/
├── engine.ts       # rollup() — generic group-by + sum
├── filters.ts      # filterRecords(), getCurrentWeek(), getLastNWeeks(), deltas
├── leaderboard.ts  # computeLeaderboard() — top N by category
└── trends.ts       # computeTrend(), computeRunningAvg()
```

#### Rollup Engine

`rollup(records, groupByFn)` is the core aggregation primitive:

```
UserWeekRepoRecord[]
    │
    ▼
groupBy(record => keyFn(record))     e.g., r => r.org, r => r.member
    │
    ▼
sum all metrics per group
    │
    ▼
Map<string, RolledUp>
```

`RolledUp` contains: commits, insertions, deletions, netLines, filesChanged, filesAdded, filesDeleted, activeDays, activeMembers (distinct count), and per-filetype breakdowns.

Every view uses `rollup()` with different key functions. The dashboard rolls up by org/team/tag; team detail rolls up by member; trends rolls up by week.

#### Filter Chain

Filters use AND-logic — all specified criteria must match:

```typescript
filterRecords(records, {
  weeks: ["2026-W06", "2026-W07", "2026-W08"],
  org: "Acme Corp",
  team: "Platform"
})
```

### Views Layer (`src/views/`)

Each view is a pure async function with the signature:

```typescript
type ViewFn = (ctx: ViewContext) => Promise<NavigationAction>
```

```
src/views/
├── types.ts          # ViewContext, NavigationAction, ViewFn type definitions
├── navigator.ts      # View stack manager (push/pop/replace/quit)
├── dashboard.ts      # Main 4-tab dashboard
├── team-detail.ts    # Per-team drill-down
├── member-detail.ts  # Per-member drill-down
└── trends.ts         # 12-week trend analysis
```

#### Navigation Model

The navigator maintains a simple view stack:

```
Stack: [Dashboard]
  user presses "1" → push TeamDetail
Stack: [Dashboard, TeamDetail]
  user presses "3" → push MemberDetail
Stack: [Dashboard, TeamDetail, MemberDetail]
  user presses "B" → pop
Stack: [Dashboard, TeamDetail]
  user presses "B" → pop
Stack: [Dashboard]
```

Each view returns a `NavigationAction`:
- `{ type: 'push', view }` — push a new view and render it
- `{ type: 'pop' }` — go back to the previous view
- `{ type: 'replace', view }` — swap the current view (tab switches)
- `{ type: 'quit' }` — exit the loop

Views are **stateless** — re-rendering from scratch on every navigation action. State lives in the `ViewContext` (config + records + currentWeek), not in the views themselves.

#### View Rendering Pattern

Each view follows the same pattern:

```
1. Clear terminal (console.clear())
2. Filter records for the relevant scope
3. Roll up records by the appropriate dimension
4. Render UI components (charts, tables, banners)
5. Print all output (console.log)
6. Wait for keypress (readKey())
7. Return a NavigationAction based on the key
```

### UI Layer (`src/ui/`)

Pure rendering functions. No state, no side effects beyond returning strings. Every function takes options and returns formatted string output.

```
src/ui/
├── constants.ts           # SEGMENT_DEFS: filetype colors and characters
├── format.ts              # fmt(), delta(), weekLabel(), ANSI-aware padding
├── grouped-hbar-chart.ts  # Grouped stacked horizontal bar chart
├── avg-output-chart.ts    # Bar chart with running average marker (◈)
├── line-chart.ts          # Multi-series line chart (solid/dotted)
├── table.ts               # ANSI-aware table with flex columns
├── sparkline.ts           # Inline sparkline (▁▂▃▄▅▆▇█)
├── bar.ts                 # Inline stacked bar segment
├── banner.ts              # Two-line header with separator
├── tab-bar.ts             # Tab bar and hotkey bar
├── legend.ts              # Color legend
└── keypress.ts            # Raw TTY single-keypress reader
```

All chart functions accept a `width` parameter (typically `min(process.stdout.columns, 120)`) and scale their output accordingly.

#### Visual Encoding

Consistent across all components:

| File Type | Character | Color |
|-----------|-----------|-------|
| App | `█` (full block) | Green |
| Test | `▓` (dark shade) | Blue |
| Config | `░` (light shade) | Yellow |
| Storybook | `▒` (medium shade) | Magenta |

## Type System (`src/types/schema.ts`)

All data types are defined as Zod schemas with inferred TypeScript types. This provides runtime validation at system boundaries (config loading, store loading) with zero-cost types at compile time.

### Core Data Type

The fundamental unit is `UserWeekRepoRecord` — one record per member per ISO week per repository:

```
UserWeekRepoRecord
├── Identity: member, email, org, orgType, team, tag
├── Dimensions: week ("YYYY-Www"), repo, group
├── Metrics: commits, activeDays
└── Filetype breakdown
    ├── app:       { files, filesAdded, filesDeleted, insertions, deletions }
    ├── test:      { files, filesAdded, filesDeleted, insertions, deletions }
    ├── config:    { files, filesAdded, filesDeleted, insertions, deletions }
    └── storybook: { files, filesAdded, filesDeleted, insertions, deletions }
```

This single grain supports all aggregations — rollup by any dimension produces the metrics needed by every view.

## Data Flow Summary

```
config.yml
    │
    ▼
[Config Loader] ──► Config object
    │
    ▼
[Collector] ──git log──► ParsedCommit[] ──classify + resolve──► UserWeekRepoRecord[]
    │                                                                │
    │                                                                ▼
    │                                                    [Store: merge + save]
    │                                                                │
    ▼                                                                ▼
[CLI Filters] ──► filtered UserWeekRepoRecord[]
    │
    ▼
[Aggregator] ──rollup──► RolledUp maps, TrendPoints, LeaderboardColumns
    │
    ▼
[Views] ──► UI Components ──► ANSI strings ──► Terminal
```

## Key Design Decisions

### Flat File Storage Over Database

Records are stored as a JSON array. This keeps the tool zero-dependency (no SQLite, no Postgres) and fully portable — the entire dataset is a single file that can be backed up, shared, or deleted trivially.

Trade-off: large organizations with many repos may hit performance limits. The `shouldAutoPrune()` function warns at 100K records or 50MB estimated size.

### ISO Week as Time Dimension

All time-based aggregation uses ISO 8601 weeks (`YYYY-Www`). This provides natural weekly cadence alignment, avoids timezone ambiguity, and makes week-over-week comparison trivial (string sort = chronological sort).

### Stateless Views

Views are pure functions that re-render from scratch on every navigation action. There's no incremental DOM, no virtual terminal, no retained state between renders. This makes views easy to test, reason about, and compose.

Trade-off: every keypress triggers a full re-render. In practice this is imperceptible because the aggregation and rendering complete in single-digit milliseconds.

### File Classification by Convention

Rather than requiring users to configure file categories, the classifier uses path-pattern heuristics (test files end in `.test.ts`, config files end in `.json`, etc.). This works out-of-the-box for the vast majority of projects.

### Author Resolution at Scan Time

Authors are resolved (email/name/alias → canonical member identity) during scanning, not during rendering. Unresolved authors are skipped entirely. This means the store contains only known team members, keeping data clean and aggregations accurate.

## Testing Strategy

```
src/__tests__/
├── classifier.test.ts          # 72 tests — every file extension and edge case
├── git.test.ts                 # 18 tests — parse output, ISO weeks, scan logic
├── author-map.test.ts          # 13 tests — resolution, aliases, case sensitivity
├── collector-index.test.ts     # 9 tests  — scan coordination, staleness, state updates
├── engine.test.ts              # 15 tests — rollup aggregation
├── filters (in trends.test.ts) # filtering, week calculation
├── leaderboard.test.ts         # 10 tests — ranking, categories
├── trends.test.ts              # 16 tests — trend computation, running averages
├── table.test.ts               # 25 tests — column sizing, truncation, ANSI
├── grouped-hbar-chart.test.ts  # 13 tests — chart rendering
├── avg-output-chart.test.ts    # 11 tests — marker positioning
├── line-chart.test.ts          # 23 tests — multi-series rendering
├── sparkline.test.ts           # 8 tests  — block character mapping
├── bar.test.ts                 # 8 tests  — segment proportions
├── banner.test.ts              # 6 tests  — header formatting
├── format.test.ts              # 26 tests — fmt, delta, padding, week labels
├── views.test.ts               # 49 tests — all view navigation and rendering
├── navigator.test.ts           # 8 tests  — stack push/pop/replace/quit
├── cli.test.ts                 # 26 tests — argument parsing, subcommands
├── loader.test.ts              # 11 tests — config loading, path resolution
├── schema.test.ts              # 32 tests — Zod schema validation
├── scan-state.test.ts          # 17 tests — state persistence, staleness
├── commits-by-filetype.test.ts # 19 tests — merge, prune, auto-prune
└── demo.test.ts                # 15 tests — synthetic data generation
```

**Total: 463 tests, 24 files.** All tests are unit tests using vitest with no external dependencies (git operations are mocked via `simple-git`).
