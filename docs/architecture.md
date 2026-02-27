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
        ├──► Author Registry ──► Author Map ──► Reattribution
        │    src/store/           src/collector/
        │
        ├──► Aggregator ──► Rollups, Trends, Leaderboards
        │    src/aggregator/
        │
        └──► Navigator ──► Views ──► UI Components ──► Terminal
             src/views/              src/ui/
```

## Layer Responsibilities

### CLI Layer (`src/cli.ts`)

The entry point. Uses `commander` to define grouped subcommands and all global flags. Responsibilities:

- Parse and validate CLI arguments
- Handle early-exit paths (`--reset`, `--store-stats`, `--json`)
- Load config, store data, author registry
- Trigger repo scanning
- Apply filters (`--org`, `--team`, `--tag`, `--group`)
- Reattribute records against current author assignments
- Construct `ViewContext` and hand off to the navigator

#### Subcommand Groups

| Group | Commands |
|-------|----------|
| (default) | Launch TUI dashboard |
| `init` | Initialize config and data directories |
| `scan` | Scan repos and exit |
| `workspace` | `create`, `list` — manage workspaces |
| `repo` | `list`, `add`, `remove` — manage repos |
| `org` | `list`, `add`, `add-team` — manage organizations |
| `author` | `list`, `assign`, `bulk-assign` — manage authors |
| `view` | `contributions`, `leaderboard`, `repo-activity`, `trends` — CLI reports |
| `data` | `export`, `export-csv`, `import` — data portability |

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
├── author-map.ts   # Author resolver — email/name/alias → member identity
│                   # Also: reattributeRecords() for post-assignment updates
└── dir-scanner.ts  # Directory scanner — discovers git repos in a path
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
  ├── resolve author (AuthorMap + IdentifierRules)
  ├── classify each file           → app | test | config | storybook
  ├── compute ISO week             → "2026-W08"
  ├── deduplicate (recentHashes)   → skip if seen
  └── accumulate by member::week::repo
    │
    ▼
UserWeekRepoRecord[]         → merged into store
```

#### Author Resolution Chain

Authors are resolved in priority order:

1. **Config members** — Email, name, or alias match (case-insensitive)
2. **Author registry** — Assigned authors (email match)
3. **Identifier rules** — Org identifier prefix match against extracted identifier (e.g., "CONEWC" starts with "CON")
4. **Unresolved** — Author not matched; records carry `org: 'unassigned'`

#### Reattribution

When author assignments change (via TUI or CLI), `reattributeRecords()` re-resolves every stored record:
- Matched authors get updated org/team/tag fields
- Explicitly unassigned authors (exist in registry but org is undefined) get forced to `unassigned`
- Already-correct records are returned as-is (no unnecessary copies)

This runs at TUI startup and after every assignment change in the Manage tab.

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
    ├── scan-state.json                 # Per-repo scan cursors
    └── authors.json                    # Author registry (discovered + assigned)
```

```
src/store/
├── paths.ts                # Path constants and ensureDataDir()
├── commits-by-filetype.ts  # Load, save, merge, prune records
├── scan-state.ts           # Load, save, update scan cursors
└── author-registry.ts      # Load, save, merge, assign/unassign authors
```

#### Author Registry (`authors.json`)

Tracks every unique git author email discovered during scanning:

```typescript
interface DiscoveredAuthor {
  email: string;
  name: string;
  identifier?: string;       // extracted from "Name (CODE)" pattern
  firstSeen: string;
  lastSeen: string;
  reposSeenIn: string[];
  commitCount: number;
  org?: string;              // undefined = unassigned
  team?: string;
}
```

Key operations:
- **`mergeDiscoveredAuthors()`** — Upsert authors during scanning (bumps counts, dates, repos)
- **`assignAuthor()`** / **`unassignAuthor()`** — Set or clear org/team
- **`assignByIdentifierPrefix()`** — Bulk-assign all authors matching a prefix
- **`getUnassignedAuthors()`** / **`getAssignedAuthors()`** — Filter queries
- **`getIdentifierPrefixes()`** — Discover unique prefixes for bulk-assign UX

#### Merge Strategy

New records are merged with existing records by composite key `member::week::repo`:
- **Existing key** — sum all metrics (commits, insertions, deletions, files, active days capped at 7)
- **New key** — append as-is

This design supports overlap-safe incremental scans. Scanning the same commit twice won't double-count because metrics are summed by the same key.

#### Atomic Writes

All store files use a write-to-temp-then-rename pattern to prevent corruption on crash:

```
data → JSON.stringify → write to .tmp file → fs.rename (atomic)
```

### Aggregator Layer (`src/aggregator/`)

Pure functions that transform flat records into view-ready structures.

```
src/aggregator/
├── engine.ts       # rollup() — generic group-by + sum
├── filters.ts      # filterRecords(), getCurrentWeek(), getLastNWeeks/Months/Quarters/Years, deltas
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

#### Time Bucketing

The aggregator supports four granularity levels:
- **Week** — ISO weeks (`2026-W08`)
- **Month** — `weekToMonth()` aggregates weeks into months
- **Quarter** — `weekToQuarter()` aggregates into quarters
- **Year** — `weekToYear()` aggregates into years

Each granularity has configurable depth ranges (e.g., 2–24 weeks, 2–12 months).

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
├── dashboard.ts      # Main 4-tab dashboard (Contributions, Repo Activity, Top Performers, Manage)
├── manage-tab.ts     # Manage tab section renderers (repos, orgs, authors, groups, tags)
├── repo-activity.ts  # Repo activity chart builder
├── team-detail.ts    # Per-team drill-down
├── member-detail.ts  # Per-member drill-down
└── trends.ts         # 12-week trend analysis
```

#### Dashboard Architecture

The dashboard (`dashboard.ts`) manages four tabs with independent state:

| Tab | State Variables |
|-----|----------------|
| Contributions | `drillLevel`, `tagOverlay`, `contribGranularity`, `contribDepth`, `contribDetail`, `contribPivotEntity`, `contribHideUnassigned` |
| Repo Activity | `repoWindowWeeks` |
| Top Performers | `leaderboardWindowWeeks` |
| Manage | `manageSection`, `manageCursorIdx` |

The `mapKey()` function translates raw keypresses into semantic actions based on the active tab, and the main loop dispatches each action to update state or trigger side effects (author assignment, repo scanning, etc.).

#### Manage Tab

The Manage tab (`manage-tab.ts`) provides five section renderers:

- **Repos** — Lists configured repos with scan status (fresh/stale/never), last scan time, commit counts
- **Orgs** — Lists organizations with their teams, member counts, and tags
- **Authors** — Lists discovered authors grouped by assignment status (assigned/unassigned), with identifier and repo info
- **Groups** — Lists repo groups and member repos
- **Tags** — Lists team tags and their associated teams

The manage tab renderers are pure functions (return strings). All mutation logic (assign, unassign, add org, remove team, scan) lives in `dashboard.ts` action handlers.

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
├── format.ts              # fmt(), delta(), weekLabel(), monthShort(), quarterShort(), yearShort(), ANSI-aware padding
├── grouped-hbar-chart.ts  # Grouped stacked horizontal bar chart
├── avg-output-chart.ts    # Bar chart with running average marker (◈)
├── line-chart.ts          # Multi-series line chart (solid/dotted)
├── table.ts               # ANSI-aware table with flex columns
├── sparkline.ts           # Inline sparkline (▁▂▃▄▅▆▇█)
├── bar.ts                 # Inline stacked bar segment
├── banner.ts              # Two-line header with separator
├── tab-bar.ts             # Tab bar, hotkey bar, and breadcrumb
├── legend.ts              # Color legend
├── keypress.ts            # Raw TTY single-keypress reader
└── readline.ts            # Line input reader (for text prompts in Manage tab)
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

### Commands Layer (`src/commands/`)

Non-interactive output functions used by CLI subcommands:

```
src/commands/
└── export-data.ts    # recordsToCsv() — CSV export logic
```

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

### Author Registry Type

```
AuthorRegistry
├── version: number
└── authors: Record<string, DiscoveredAuthor>
    └── DiscoveredAuthor
        ├── email, name, identifier?
        ├── firstSeen, lastSeen
        ├── reposSeenIn[], commitCount
        └── org?, team?  (undefined = unassigned)
```

## Data Flow Summary

```
config.yml + authors.json
    │
    ▼
[Config Loader] ──► Config object
[Author Registry] ──► AuthorRegistry
    │
    ▼
[Collector] ──git log──► ParsedCommit[] ──classify + resolve──► UserWeekRepoRecord[]
    │                                           │                      │
    │                                    [merge authors]               ▼
    │                                    into registry       [Store: merge + save]
    │                                                                  │
    ▼                                                                  ▼
[Reattribute Records] ──► UserWeekRepoRecord[] (with current org/team)
    │
    ▼
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

### Multi-Granularity Time Buckets

While the underlying data grain is always ISO weeks, the UI supports viewing data at month, quarter, and year granularity. Aggregation functions (`weekToMonth`, `weekToQuarter`, `weekToYear`) map weeks to higher-level buckets, and the user can switch granularity with `+/-` keys.

### Stateless Views

Views are pure functions that re-render from scratch on every navigation action. There's no incremental DOM, no virtual terminal, no retained state between renders. This makes views easy to test, reason about, and compose.

Trade-off: every keypress triggers a full re-render. In practice this is imperceptible because the aggregation and rendering complete in single-digit milliseconds.

### File Classification by Convention

Rather than requiring users to configure file categories, the classifier uses path-pattern heuristics (test files end in `.test.ts`, config files end in `.json`, etc.). This works out-of-the-box for the vast majority of projects.

### Author Resolution at Scan Time + Reattribution at Startup

Authors are resolved during scanning, but assignments can change after data is stored. The reattribution step on startup ensures records always reflect the latest author registry state. This two-phase approach means:
- Scanning doesn't need to be re-run when assignments change
- Records on disk may have stale org/team values, but they're corrected before display
- Unassigned authors are explicitly tracked (not silently dropped)

### Manage Tab as Configuration UI

Rather than requiring users to edit YAML files, the Manage tab provides full CRUD operations for repos, orgs, teams, and authors. All mutations persist to disk immediately, and records are reattributed after every assignment change.

## Testing Strategy

```
src/__tests__/
├── classifier.test.ts          # 72 tests — every file extension and edge case
├── git.test.ts                 # 25 tests — parse output, ISO weeks, scan logic
├── author-map.test.ts          # 17 tests — resolution, aliases, case sensitivity, reattribution
├── author-registry.test.ts     # 16 tests — merge, assign, unassign, bulk-assign, prefix detection
├── collector-index.test.ts     # 12 tests — scan coordination, staleness, state updates
├── engine.test.ts              # 15 tests — rollup aggregation
├── leaderboard.test.ts         # 10 tests — ranking, categories
├── trends.test.ts              # 16 tests — trend computation, running averages
├── table.test.ts               # 25 tests — column sizing, truncation, ANSI
├── grouped-hbar-chart.test.ts  # 21 tests — chart rendering
├── avg-output-chart.test.ts    # 11 tests — marker positioning
├── line-chart.test.ts          # 23 tests — multi-series rendering
├── sparkline.test.ts           # 8 tests  — block character mapping
├── bar.test.ts                 # 8 tests  — segment proportions
├── banner.test.ts              # 6 tests  — header formatting
├── format.test.ts              # 26 tests — fmt, delta, padding, week/month/quarter labels
├── views.test.ts               # 52 tests — all view navigation and rendering
├── navigator.test.ts           # 8 tests  — stack push/pop/replace/quit
├── cli.test.ts                 # 34 tests — argument parsing, subcommands, grouped commands
├── loader.test.ts              # 11 tests — config loading, path resolution
├── schema.test.ts              # 40 tests — Zod schema validation
├── scan-state.test.ts          # 17 tests — state persistence, staleness
├── commits-by-filetype.test.ts # 19 tests — merge, prune, auto-prune
├── demo.test.ts                # 15 tests — synthetic data generation
├── paths.test.ts               # 13 tests — path utilities, directory creation
├── dir-scanner.test.ts         # 9 tests  — directory git repo discovery
├── export-data.test.ts         # 22 tests — CSV export formatting
├── export.test.ts              # 9 tests  — YAML export portability
├── import.test.ts              # 23 tests — YAML import, conflict resolution
├── functional.test.ts          # 19 tests — end-to-end functional tests
├── git-root.test.ts            # 4 tests  — git root detection
├── repos-registry.test.ts      # 20 tests — repos registry operations
├── repos-registry-save.test.ts # 8 tests  — repos registry persistence
└── workspace-selector.test.ts  # 8 tests  — workspace selection logic
```

**Total: 642 tests, 34 files.** All tests are unit tests using vitest with no external dependencies (git operations are mocked via `simple-git`).
