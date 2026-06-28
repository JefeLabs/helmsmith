# GitRadar Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI (commander)                                                 │
│  src/cli.ts                                                      │
│  Parses args, routes to subcommands or run-main                  │
└───────┬──────────────────────────────────────────────────────────┘
        │
        ├──► GitRadarEngine (src/engine/gitradar-engine.ts)
        │    Orchestrates workspace, scanning, enrichment, filtering
        │
        ├──► Config Loader ──► Zod Validation ──► Config
        │    src/config/         src/types/
        │
        ├──► Collector ──► SQLite Store
        │    src/collector/      src/store/sqlite-store.ts
        │
        ├──► Enricher ──► GitHub API ──► Enrichment Store
        │    src/commands/enrich.ts     (via octokit)
        │
        ├──► Author Registry ──► Author Map ──► Reattribution
        │    src/store/           src/collector/
        │
        ├──► Aggregator ──► Rollups, Trends, Leaderboards, Segments
        │    src/aggregator/
        │
        └──► Navigator ──► Views ──► UI Components ──► Terminal
             src/views/              src/ui/
```

## Layer Responsibilities

### CLI Layer (`src/cli.ts`)

The entry point. Uses `commander` to define grouped subcommands and all global flags. Responsibilities:

- Parse and validate CLI arguments
- Route to the appropriate subcommand handler
- Define global flags (`--org`, `--team`, `--tag`, `--group`, `-w`, `--demo`, `--json`, etc.)

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
| `data` | `export`, `export-csv`, `import`, `enrich` — data portability and enrichment |

### Engine Layer (`src/engine/gitradar-engine.ts`)

The central orchestrator that replaced scattered startup logic. Manages the full lifecycle:

```
resolveWorkspace() → loadStores() → scan() → enrich() → applyFilters() → buildViewContext()
```

Key responsibilities:
- **Workspace resolution** — selects and validates the active workspace
- **Store management** — loads config, SQLite database, author registry
- **Scanning** — coordinates incremental git log scanning across all repos
- **Enrichment** — triggers GitHub API enrichment for PR metrics
- **SQL-based filtering** — pushes filter predicates to the database via `queryRecords()`
- **ViewContext construction** — builds the typed context object for the TUI
- **Reactive refresh** — `onRefreshData()` detects external database changes (e.g., background `--watch` scans) and reloads data
- **Auto-pruning** — removes records older than the configured retention window

In demo mode, the engine uses in-memory records from `generateDemoData()` and skips SQL-based filtering.

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
├── git.ts          # Git log parser — runs git, parses output, extracts intent/scopes
├── classifier.ts   # File classifier — app/test/config/storybook/doc
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
  ├── classify each file           → app | test | config | storybook | doc
  ├── compute ISO week             → "2026-W08"
  ├── parse conventional commit    → intent, scopes, breaking changes
  ├── deduplicate (recentHashes)   → skip if seen
  └── accumulate by member::week::repo
    │
    ▼
UserWeekRepoRecord[]         → inserted into SQLite
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

SQLite-based persistence with WAL mode for crash safety and concurrent access.

```
~/.agentx/gitradar/
├── config.yml                          # User configuration
└── data/
    ├── gitradar.db                     # SQLite database (records, enrichments, scan state, meta)
    └── authors.json                    # Author registry (discovered + assigned)
```

```
src/store/
├── sqlite-store.ts     # Main database layer — schema, migrations, CRUD, queries
├── db-watcher.ts       # Reactive file watcher — AbortSignal on DB changes
├── paths.ts            # Path constants and ensureDataDir()
├── scan-state.ts       # Load, save, update scan cursors (SQL-backed)
└── author-registry.ts  # Load, save, merge, assign/unassign authors
```

#### SQLite Schema

| Table | Purpose |
|-------|---------|
| `records` | All `UserWeekRepoRecord` data with composite key (member, week, repo) |
| `enrichments` | PR metrics, cycle time, reviews, churn per member/week/repo |
| `scan_state` | Per-repo scan cursors (lastHash, lastScanDate, recentHashes) |
| `meta` | Timestamps for change detection (commitsUpdated, enrichmentsUpdated) |

Key database features:
- **WAL mode** — enables concurrent reads during background scans
- **Upsert semantics** — `INSERT OR REPLACE` for idempotent record merging
- **Transaction wrapping** — atomic batch operations (e.g., `resetAllData`)
- **Reactive watching** — `DbWatcher` monitors the `.db` and `.db-wal` files for external changes, providing `AbortSignal`s that interrupt the TUI's poll interval for near-instant updates

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

### Aggregator Layer (`src/aggregator/`)

Pure functions that transform flat records into view-ready structures.

```
src/aggregator/
├── engine.ts       # rollup() — generic group-by + sum
├── filters.ts      # filterRecords(), getCurrentWeek(), getLastNWeeks/Months/Quarters/Years, deltas
├── leaderboard.ts  # computeLeaderboard() — top N by category
├── trends.ts       # computeTrend(), computeRunningAvg()
├── segments.ts     # calculateSegments() — high/middle/low tier assignment
└── metrics.ts      # Derived metric calculations (testPct, etc.)
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

`RolledUp` contains: commits, insertions, deletions, netLines, filesChanged, filesAdded, filesDeleted, activeDays, activeMembers (distinct count), and per-filetype breakdowns (app, test, config, storybook, doc).

Every view uses `rollup()` with different key functions. The dashboard rolls up by org/team/tag; team detail rolls up by member; trends rolls up by week.

#### Segment Calculation

`calculateSegments(memberTotals, thresholds)` assigns each entity a tier:

- **N ≥ 5**: top `ceil(N × high%)` = high, bottom `ceil(N × low%)` = low, rest = middle
- **N < 5**: top 1 = high, bottom 1 = low, rest = middle
- **Zero-value** entries are always "low"

Segments are computed post-filter and reflect the current view, not stored data.

#### Time Bucketing

The aggregator supports four granularity levels:
- **Week** — ISO weeks (`2026-W08`)
- **Month** — `weekToMonth()` aggregates weeks into months
- **Quarter** — `weekToQuarter()` aggregates into quarters
- **Year** — `weekToYear()` aggregates into years

Each granularity has configurable depth ranges (e.g., 2–24 weeks, 2–12 months).

#### SQL-Accelerated Rollup

When available, views use `queryRollup()` to push aggregation to the SQLite database for better performance with large datasets, bypassing the in-memory `rollup()` function.

### Views Layer (`src/views/`)

Each view is a pure async function with the signature:

```typescript
type ViewFn = (ctx: ViewContext) => Promise<NavigationAction>
```

```
src/views/
├── types.ts                 # ViewContext, NavigationAction, ViewFn type definitions
├── navigator.ts             # View stack manager (push/pop/replace/quit)
├── dashboard.ts             # Main 4-tab dashboard (Contributions, Repo Activity, Top Performers, Manage)
├── manage-tab.ts            # Manage tab section renderers (repos, orgs, authors, groups, tags)
├── repo-activity.ts         # Repo activity chart builder
├── team-detail.ts           # Per-team drill-down
├── member-detail.ts         # Per-member drill-down
├── trends.ts                # 12-week trend analysis
└── components/
    ├── contribution-section.ts    # Contribution chart + detail table rendering
    ├── repo-activity-section.ts   # Repo activity section rendering
    └── top-performers-section.ts  # Leaderboard section rendering
```

#### Dashboard Architecture

The dashboard (`dashboard.ts`) manages four tabs with independent state:

| Tab | State Variables |
|-----|----------------|
| Contributions | `drillLevel`, `tagOverlay`, `contribGranularity`, `contribDepth`, `contribTableMode`, `contribPivotEntity`, `contribHideUnassigned`, `contribExcludedSegments`, `contribDetailLayers`, `contribPerUserMode`, `contribLabelWidth` |
| Repo Activity | `repoWindowWeeks` |
| Top Performers | `leaderboardWindowWeeks` |
| Manage | `manageSection`, `manageRepoIdx`, `manageAuthorIdx` |

The `mapKey()` function translates raw keypresses into semantic actions based on the active tab, and the main loop dispatches each action to update state or trigger side effects (author assignment, repo scanning, etc.).

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

Views are **stateless** — re-rendering from scratch on every navigation action. State lives in the `ViewContext` (config + records + currentWeek + enrichments), not in the views themselves.

#### View Rendering Pattern

Each view follows the same pattern:

```
1. Clear terminal (process.stdout.write ANSI clear sequence)
2. Filter records for the relevant scope
3. Roll up records by the appropriate dimension
4. Render UI components (charts, tables, banners)
5. Print all output (console.log)
6. Wait for keypress (readKey()) — interruptible via DbWatcher AbortSignal
7. Return a NavigationAction based on the key
```

### UI Layer (`src/ui/`)

Pure rendering functions. No state, no side effects beyond returning strings. Every function takes options and returns formatted string output.

```
src/ui/
├── constants.ts           # FILETYPE_CHARS, FILETYPE_COLORS, SEGMENT_DEFS, SEGMENT_INDICATORS
├── format.ts              # fmt(), delta(), weekShort(), monthShort(), quarterShort(), yearShort(), ANSI-aware padding
├── grouped-hbar-chart.ts  # Grouped stacked horizontal bar chart with detail layers
├── avg-output-chart.ts    # Bar chart with running average marker (◈)
├── line-chart.ts          # Multi-series line chart (solid/dotted)
├── table.ts               # ANSI-aware table with flex columns
├── sparkline.ts           # Inline sparkline (▁▂▃▄▅▆▇█)
├── bar.ts                 # Inline stacked bar segment
├── banner.ts              # Two-line header with separator
├── tab-bar.ts             # Tab bar, hotkey bar, and breadcrumb
├── legend.ts              # Color legend
├── cli-renderer.ts        # Reusable output renderer for CLI commands
├── keypress.ts            # Raw TTY single-keypress reader
└── readline.ts            # Line input reader (for text prompts in Manage tab)
```

All chart functions accept a `width` parameter (typically `process.stdout.columns`) and scale their output accordingly.

#### Visual Encoding

Consistent across all components:

| File Type | Character | Color |
|-----------|-----------|-------|
| App | `█` (full block) | Green |
| Test | `▓` (dark shade) | Blue |
| Config | `░` (light shade) | Yellow |
| Storybook | `▒` (medium shade) | Magenta |
| Doc | `▔` (upper bar) | Cyan |

#### Segment Indicators

| Tier | Character | Color |
|------|-----------|-------|
| High | `▲` | Green |
| Middle | `●` | Dim |
| Low | `▼` | Red |

### Commands Layer (`src/commands/`)

Handlers for CLI subcommands and the main TUI entry point:

```
src/commands/
├── run-main.ts         # Main entry orchestrator — delegates to GitRadarEngine
├── contributions.ts    # CLI contributions report with drill-down
├── repo-activity.ts    # CLI repo activity report
├── leaderboard.ts      # CLI leaderboard report
├── export-data.ts      # recordsToCsv() — CSV export logic
├── enrich.ts           # GitHub enrichment command (PR metrics, churn)
├── add-org.ts          # Add organization command
├── assign-author.ts    # Assign/bulk-assign author commands
├── list-authors.ts     # List authors command
├── manage-repos.ts     # Repo add/list/remove commands
├── export.ts           # YAML export command
└── import.ts           # YAML import command
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
├── Filetype breakdown
│   ├── app:       { files, filesAdded, filesDeleted, insertions, deletions }
│   ├── test:      { files, filesAdded, filesDeleted, insertions, deletions }
│   ├── config:    { files, filesAdded, filesDeleted, insertions, deletions }
│   ├── storybook: { files, filesAdded, filesDeleted, insertions, deletions }
│   └── doc:       { files, filesAdded, filesDeleted, insertions, deletions }
├── Intent (optional)
│   ├── feat, fix, refactor, docs, test, chore, other (commit counts per type)
├── breakingChanges: number
└── scopes: string[]
```

### Enrichment Types

```
ProductivityExtensions
├── prs_opened, prs_merged
├── avg_cycle_hrs, reviews_given
├── churn_rate_pct
└── pr_feature, pr_fix, pr_bugfix, pr_chore, pr_hotfix, pr_other

EnrichmentStore
├── enrichments: Record<string, ProductivityExtensions>   # key: "member::week::repo"
```

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
[GitRadarEngine]
  ├── resolveWorkspace() → loadStores()
  │
  ├── [Collector] ──git log──► ParsedCommit[]
  │     ├── classify + resolve ──► UserWeekRepoRecord[]
  │     ├── parse intent + scopes
  │     └── [SQLite Store: upsert records]
  │
  ├── [Enricher] ──GitHub API──► PR metrics, churn
  │     └── [SQLite Store: upsert enrichments]
  │
  ├── applyFilters() ──SQL predicates──► filtered records
  │
  └── buildViewContext() ──► ViewContext
        ├── reattributeRecords()
        ├── loadEnrichmentsSQL()
        ├── DbWatcher (reactive refresh)
        └── queryRollup (SQL-accelerated aggregation)
    │
    ▼
[Aggregator] ──rollup──► RolledUp maps, TrendPoints, LeaderboardColumns, Segments
    │
    ▼
[Views] ──► UI Components ──► ANSI strings ──► Terminal
```

## Key Design Decisions

### SQLite Over Flat Files

Records are stored in a SQLite database using `better-sqlite3`. This provides:
- **Crash safety** — WAL mode ensures consistency even on unexpected termination
- **Concurrent access** — background `--watch` scans and the TUI can run simultaneously
- **SQL-accelerated queries** — `queryRecords()` and `queryRollup()` push predicates to the database
- **Reactive updates** — `DbWatcher` monitors DB file changes for near-instant TUI refreshes
- **Atomic operations** — transactions wrap multi-table operations like `resetAllData`

The `shouldAutoPrune()` function warns at 100K records and supports configurable retention.

### ISO Week as Time Dimension

All time-based aggregation uses ISO 8601 weeks (`YYYY-Www`). This provides natural weekly cadence alignment, avoids timezone ambiguity, and makes week-over-week comparison trivial (string sort = chronological sort).

### Multi-Granularity Time Buckets

While the underlying data grain is always ISO weeks, the UI supports viewing data at month, quarter, and year granularity. Aggregation functions (`weekToMonth`, `weekToQuarter`, `weekToYear`) map weeks to higher-level buckets, and the user can switch granularity with `+/-` keys.

### Stateless Views

Views are pure functions that re-render from scratch on every navigation action. There's no incremental DOM, no virtual terminal, no retained state between renders. This makes views easy to test, reason about, and compose.

Trade-off: every keypress triggers a full re-render. In practice this is imperceptible because the aggregation and rendering complete in single-digit milliseconds.

### File Classification by Convention

Rather than requiring users to configure file categories, the classifier uses path-pattern heuristics (test files end in `.test.ts`, config files end in `.json`, etc.). This works out-of-the-box for the vast majority of projects. Five categories: app, test, config, storybook, doc.

### Conventional Commit Parsing

Intent tracking extracts semantic meaning from commit messages following the conventional commits specification. This enables analysis of what *kind* of work teams are doing (features vs. fixes vs. refactoring) beyond just volume metrics.

### Author Resolution at Scan Time + Reattribution at Startup

Authors are resolved during scanning, but assignments can change after data is stored. The reattribution step on startup ensures records always reflect the latest author registry state. This two-phase approach means:
- Scanning doesn't need to be re-run when assignments change
- Records in SQLite may have stale org/team values, but they're corrected before display
- Unassigned authors are explicitly tracked (not silently dropped)

### Segment Filtering at User Level

When segment exclusions are applied at the org or team drill level, segments are computed on **individual users** and their records are filtered before aggregation. This prevents entire orgs/teams from disappearing when hiding a tier — instead, the aggregated bars show reduced totals reflecting only the included contributors.

### Manage Tab as Configuration UI

Rather than requiring users to edit YAML files, the Manage tab provides full CRUD operations for repos, orgs, teams, and authors. All mutations persist to disk immediately, and records are reattributed after every assignment change.

### Engine Decoupling

The `GitRadarEngine` class encapsulates the full data lifecycle (workspace → scan → enrich → filter → context). This separation enables:
- Clean demo mode (in-memory records without SQL filtering)
- Background scanning (`--watch` mode)
- CLI commands that share the same data pipeline as the TUI
- Future external tool integrations via the engine API

## Testing Strategy

```
src/__tests__/
├── classifier.test.ts          # File extension and path classification
├── git.test.ts                 # Git log parsing, ISO weeks, scan logic
├── author-map.test.ts          # Resolution, aliases, case sensitivity, reattribution
├── author-registry.test.ts     # Merge, assign, unassign, bulk-assign, prefix detection
├── collector-index.test.ts     # Scan coordination, staleness, state updates
├── engine.test.ts              # Rollup aggregation
├── leaderboard.test.ts         # Ranking, categories
├── trends.test.ts              # Trend computation, running averages
├── segments.test.ts            # Segment calculation, thresholds, edge cases
├── filters.test.ts             # Record filtering, time functions
├── table.test.ts               # Column sizing, truncation, ANSI
├── grouped-hbar-chart.test.ts  # Chart rendering, detail layers
├── avg-output-chart.test.ts    # Marker positioning
├── line-chart.test.ts          # Multi-series rendering
├── sparkline.test.ts           # Block character mapping
├── bar.test.ts                 # Segment proportions
├── banner.test.ts              # Header formatting
├── format.test.ts              # fmt, delta, padding, week/month/quarter labels
├── views.test.ts               # All view navigation and rendering
├── navigator.test.ts           # Stack push/pop/replace/quit
├── cli.test.ts                 # Argument parsing, subcommands, grouped commands
├── cli-renderer.test.ts        # Reusable CLI output renderer
├── loader.test.ts              # Config loading, path resolution
├── schema.test.ts              # Zod schema validation
├── scan-state.test.ts          # State persistence, staleness
├── sqlite-store.test.ts        # SQLite CRUD, migrations, queries
├── db-watcher.test.ts          # Reactive file watching
├── demo.test.ts                # Synthetic data generation
├── paths.test.ts               # Path utilities, directory creation
├── dir-scanner.test.ts         # Directory git repo discovery
├── export-data.test.ts         # CSV export formatting
├── export.test.ts              # YAML export portability
├── import.test.ts              # YAML import, conflict resolution
├── functional.test.ts          # End-to-end functional tests
├── git-root.test.ts            # Git root detection
├── github.test.ts              # GitHub API mocking, enrichment
├── repos-registry.test.ts      # Repos registry operations
├── repos-registry-save.test.ts # Repos registry persistence
├── workspace-selector.test.ts  # Workspace selection logic
└── keypress.test.ts            # Key normalization
```

**Total: 841 tests, 40 files.** All tests are unit tests using vitest with no external dependencies (git operations are mocked via `simple-git`, GitHub API mocked via `octokit`).
