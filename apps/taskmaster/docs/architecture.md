# AgentX Taskmaster — Architecture

This document describes how the solution is composed: the modules, data flow, key design decisions, and how they connect.

---

## High-Level Pipeline

Data flows through a linear pipeline of six stages. Each stage is an independent module under `src/` with its own types, public API, and tests.

```
┌──────────┐    ┌──────────┐    ┌─────────────┐    ┌────────────┐    ┌──────────────┐    ┌────────────┐
│  Parser   │───▶│  Scorer   │───▶│  Decomposer  │───▶│  Readiness  │───▶│  Generator    │───▶│   Output    │
│           │    │           │    │              │    │  Resolver   │    │  (Handlebars) │    │  (Terminal) │
└──────────┘    └──────────┘    └─────────────┘    └────────────┘    └──────────────┘    └────────────┘
     ▲                                                                        │
     │                                                                        ▼
  Plan file                                                          YAML task files
  (.md/.txt/.yaml)                                                   Reports, Manifests
```

Every command in the CLI composes one or more of these stages. For example, `parse` uses Parser + Skills; `score` uses Scorer; `ready` uses Readiness + Generator.

---

## Module Map

```
src/
├── cli.ts                  ← CLI entry point (Commander.js). Routes commands to modules.
│
├── parser/                 ← Stage 1: Plan → Structured Sections → TaskNode[]
│   ├── index.ts            Format detection + routing
│   ├── markdown.ts         Heading/section extraction from .md files
│   ├── text.ts             Plain text parsing (separator-based, bullet-based)
│   ├── yaml-plan.ts        YAML structured plan parsing
│   ├── ai-parser.ts        AI-powered parsing via Copilot API
│   ├── task-generator.ts   Sections → TaskNode[] with ID assignment and type mapping
│   └── types.ts            ParseResult, ParseOptions, PlanFormat
│
├── scorer/                 ← Stage 2: TaskNode[] → Complexity scores (1-10)
│   ├── index.ts            Factory: createScorer() → HeuristicScorer or AIScorer
│   ├── heuristic.ts        Weighted multi-dimension scoring (no AI needed)
│   ├── dimensions.ts       Five analyzers: scope, depth, deps, ambiguity, cross-cutting
│   ├── ai-scorer.ts        Copilot-based scoring with prompt engineering
│   └── types.ts            ScoringProvider interface, ScoredResult, weights
│
├── decomposer/             ← Stage 3: High-complexity tasks → Subtask children
│   ├── index.ts            Public API: expandTask, expandMultiple
│   ├── expander.ts         Style-aware expansion, depth tracking, AI/heuristic paths
│   └── types.ts            ExpansionResult, ExpansionOptions
│
├── readiness/              ← Stage 4: Dependency graph → ready/blocked/pending
│   ├── index.ts            Public API: recomputeAllReadiness, buildDelegationManifest
│   ├── resolver.ts         Readiness computation, next task, validation
│   ├── dag.ts              DAG builder (Kahn's algorithm), cycle/orphan detection, auto-fix
│   └── types.ts            DelegationManifest, ReadinessResult, ValidationReport
│
├── skills/                 ← Cross-cutting: Skill tagging on tasks
│   ├── index.ts            Public API: inferSkills, validateSkills
│   ├── inference.ts        Keyword-based + AI-based skill inference, inheritance
│   ├── validation.ts       Vocabulary enforcement, closest-match suggestions
│   └── types.ts            SkillInferenceResult, built-in skill list
│
├── config/                 ← Configuration and state management
│   ├── schema.ts           Zod schemas: TaskNode, ProjectConfig, Dependency, etc.
│   ├── loader.ts           Read/write config.yaml per project
│   ├── resolver.ts         Project resolution: --project flag → projects.yaml → auto-detect
│   ├── styles.ts           Hierarchy style definitions (agile-full, story-driven, etc.)
│   ├── state-engine.ts     State presets, transition validation, category queries
│   └── state-presets.ts    Built-in presets: simple, standard, kanban
│
├── formats/                ← Data persistence and format bridge
│   ├── index.ts            Public API
│   ├── tasks-store.ts      Atomic read/write of tasks.json with file locking
│   ├── task-writer.ts      Generate individual YAML task files from tasks.json
│   ├── sync.ts             Merge edited YAML task files back into tasks.json
│   ├── yaml-bridge.ts      js-yaml wrapper for safe load/dump
│   └── config-reader.ts    Config.yaml reading with Zod validation
│
├── generator/              ← Template engine (Handlebars + marked-terminal)
│   ├── index.ts            Template compilation, rendering to markdown or ANSI terminal
│   ├── helpers.ts          Custom helpers: complexity-color, status-badge, progress-bar, etc.
│   └── types.ts            Template context interfaces (TaskList, ComplexityReport, etc.)
│
├── templates/              ← Handlebars .hbs templates
│   ├── task-list.hbs       Table view for `list` command
│   ├── task-detail.hbs     Full detail view for `show` command
│   ├── complexity-report.hbs
│   ├── progress-report.hbs
│   ├── summary-report.hbs
│   ├── dependency-graph.hbs  (includes Mermaid syntax)
│   └── partials/           Reusable fragments
│       ├── task-row.hbs
│       ├── dependency-list.hbs
│       ├── metadata-block.hbs
│       ├── subtask-tree.hbs
│       └── skill-badges.hbs
│
├── prompts/                ← Interactive CLI flows (Inquirer.js)
│   ├── factory.ts          Reusable prompt builders (input, list, checkbox, confirm)
│   ├── init-wizard.ts      Multi-step project setup wizard
│   ├── add-task.ts         Guided task creation prompts
│   ├── config-editor.ts    Interactive config editing + --set/--get
│   ├── confirmations.ts    Destructive action confirmations (remove, expand, bulk)
│   └── index.ts
│
├── commands/               ← Command implementations (extracted from cli.ts)
│   ├── add.ts              Task creation logic
│   ├── remove.ts           Task removal with cascade
│   ├── set-status.ts       Status transitions with validation
│   └── index.ts
│
├── reports/                ← Report aggregation
│   ├── aggregator.ts       Summary, complexity, progress, dependency data builders
│   ├── index.ts            Report type → template name mapping
│   └── types.ts            ReportType, ReportFormat, SummaryReportContext
│
├── auth/                   ← GitHub Copilot authentication
│   ├── device-flow.ts      OAuth device code flow (request code → poll → token)
│   ├── token-manager.ts    Token resolution, Copilot API token refresh, API calls
│   ├── index.ts
│   └── types.ts            AuthCredentials, CopilotTokenResponse, model definitions
│
└── utils/                  ← Shared utilities
    ├── home.ts             Global home (~/.agentx-userdata/taskmaster/) bootstrap
    ├── defaults.ts         Smart defaults (last-used-wins) read/write
    └── projects.ts         Project registry CRUD (projects.yaml)
```

---

## Core Data Model

The entire system revolves around one recursive type: **TaskNode**. Defined in `src/config/schema.ts` with Zod for runtime validation.

```
TaskNode
├── id: string              "T-1", "T-1.2", "T-1.2.3"
├── title: string
├── description: string
├── type: epic | story | task | subtask
├── status: string          Configurable per project (presets or custom)
├── complexity: 1-10        Assigned by scorer
├── priority: critical | high | medium | low
├── requiredSkills: string[]   For delegation matching
├── dependencies: Dependency[]
│   ├── taskId: string       Points to a prerequisite task
│   └── type: blocks | produces | relates
├── readiness: ready | blocked | pending   (computed, never set manually)
├── assignee: string | null
├── outputs: string[]       What this task produces for downstream tasks
├── tags: string[]
├── children: TaskNode[]    Recursive — subtasks nest here
└── metadata
    ├── source: string      Line/section from original plan
    ├── autoExpanded: boolean
    ├── skillsInferred: boolean
    └── createdAt: datetime
```

**`tasks.json` is the single source of truth.** YAML task files are generated projections. The `sync` command merges YAML edits back.

---

## Data Flow Per Command

### `parse <file>`

```
File content (.md/.txt/.yaml)
  → detectFormat() identifies format by extension, then content inspection
  → markdown.ts / text.ts / yaml-plan.ts extracts sections
  → task-generator.ts maps sections → TaskNode[] with IDs and type mapping
  → [if AI available] ai-parser.ts sends to Copilot for structured breakdown
  → skills/inference.ts tags required skills (keyword or AI)
  → tasks-store.ts writes to tasks.json (with file locking)
```

### `score`

```
tasks.json → readTasks()
  → createScorer() → HeuristicScorer (always) or AIScorer (if authenticated)
  → HeuristicScorer: 5 dimensions × configurable weights → weighted average
  → AIScorer: sends task context to Copilot → parses response → blends with heuristic
  → writeTasks() persists scores
```

### `expand <id>`

```
tasks.json → find task by ID
  → getChildType() checks max depth for project style
  → [if AI available] builds prompt → Copilot generates subtask breakdown
  → [else] heuristicExpand() generates subtasks from keyword analysis
  → assigns child IDs (T-1.1, T-1.2, ...), inherits skills
  → writeTasks() persists children
```

### `ready`

```
tasks.json → readTasks()
  → recomputeAllReadiness():
      flattenTasks() → buildTaskMap()
      for each task: check if all blocks/produces deps are in closed state
      → ready | blocked (with waitingOn list) | pending (no deps)
  → buildDelegationManifest():
      groups into ready_tasks and blocked_tasks
      adds summary counts
  → output as JSON / YAML / table
```

### `validate`

```
tasks.json → flattenTasks()
  → buildDag(): Kahn's algorithm for topological sort → detect cycles
  → detectDanglingRefs(): find deps pointing to non-existent tasks
  → validateSkills(): check against vocabulary, suggest closest match
  → [if --fix] fixCycles() removes back-edges, fixDanglingRefs() removes invalid deps
```

---

## Rendering Pipeline

All terminal output follows a two-stage pipeline:

```
Data (TaskNode[], report context)
  → Handlebars template (.hbs)       Produces markdown string
  → marked + marked-terminal          Converts markdown → ANSI-styled terminal output
```

This means:
- **All display logic lives in `.hbs` templates**, not in TypeScript
- Users can override any template by placing a same-named `.hbs` file in their project's `templates/` directory
- `--format json` bypasses the template pipeline entirely, emitting raw JSON
- Custom Handlebars helpers (`complexity-color`, `status-badge`, `progress-bar`, etc.) are registered globally

---

## State & Persistence

All state lives outside the repository in a global home directory:

```
~/.agentx-userdata/taskmaster/
├── auth.json              Copilot OAuth credentials (never in project config)
├── defaults.yaml          Smart defaults: last-used-wins across projects
├── projects.yaml          Project registry + active project pointer
└── <project>/
    ├── tasks.json          Canonical task store (JSON, file-locked)
    ├── config.yaml         Project configuration
    ├── tasks/              Generated YAML task files (projections)
    ├── templates/          User-overridable Handlebars templates
    └── docs/               Input plans, generated reports
```

**Key properties:**
- **Atomic writes**: `tasks-store.ts` uses `proper-lockfile` + write-to-temp + rename to prevent corruption
- **Multi-session safe**: Multiple CLI instances can read concurrently; file locking serializes writes
- **Repos stay clean**: No dotfolders or state files in the project directory
- **Multi-project**: Each project is fully isolated under its own directory
- **Env override**: `AGENTX_USERDATA` relocates the home (CI/CD, testing)

---

## Authentication Architecture

```
                                   ┌─────────────────────┐
                                   │   Environment Vars    │
                                   │  COPILOT_GITHUB_TOKEN │
                                   │  or GITHUB_TOKEN      │
                                   └──────────┬────────────┘
                                              │ (highest precedence)
┌──────────────┐    OAuth Device Flow    ┌────▼──────────────┐
│   CLI User    │ ◀═══════════════════▶  │   auth.json        │
│ (auth login)  │   code + browser auth  │  (long-lived token)│
└──────────────┘                         └────┬──────────────┘
                                              │
                                     getCopilotToken()
                                     (auto-refresh)
                                              │
                                    ┌─────────▼───────────┐
                                    │  Short-lived Copilot │
                                    │  API token           │
                                    │  (cached in memory)  │
                                    └─────────┬───────────┘
                                              │
                                    callCopilot(messages)
                                              │
                                    ┌─────────▼───────────┐
                                    │  GitHub Copilot API   │
                                    │  (OpenAI-compatible)  │
                                    └──────────────────────┘
```

**Token resolution order**: `COPILOT_GITHUB_TOKEN` → `GITHUB_TOKEN` → `auth.json`. The system always works without auth — AI features degrade to heuristic-only mode.

---

## Scoring Architecture

The scorer uses a **strategy pattern** — a factory returns either `HeuristicScorer` or `AIScorer`, both implementing the `ScoringProvider` interface.

```typescript
interface ScoringProvider {
  scoreTask(task: TaskNode, allTasks: TaskNode[]): Promise<ScoredResult>;
}
```

**Heuristic scoring** analyzes five weighted dimensions:

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| Scope Breadth | 20% | Number of distinct concerns mentioned |
| Technical Depth | 25% | Infrastructure, security, performance patterns |
| Dependency Count | 15% | How many other tasks it interacts with |
| Ambiguity | 20% | Vagueness of requirements |
| Cross-Cutting | 20% | Whether it spans multiple modules/systems |

**AI scoring** sends task context to Copilot, parses the structured response, and blends the AI score with the heuristic baseline.

---

## Dependency & Readiness Model

Dependencies form a **directed acyclic graph (DAG)**. The `readiness/dag.ts` module implements:

- **Topological sort** via Kahn's algorithm — used for `next` command ordering
- **Cycle detection** — identifies nodes involved in cycles
- **Dangling reference detection** — deps pointing to non-existent tasks
- **Auto-fix** — removes back-edges to break cycles, removes invalid refs

**Readiness rules:**
- No dependencies → `pending` (treated as ready)
- All `blocks`/`produces` deps in closed state → `ready`
- Any `blocks`/`produces` dep NOT in closed state → `blocked` (with `waitingOn` list)
- `relates` dependencies are informational — they don't affect readiness

Readiness is **recomputed on every status change**, never stored manually.

---

## Configurable State Machine

Task states are fully configurable per project with three built-in presets:

| Preset | States | Transitions |
|--------|--------|-------------|
| **Simple** | todo → in-progress → done | Linear |
| **Standard** | backlog → todo → in-progress → review → done + blocked | Branching |
| **Kanban** | backlog → ready → in-progress → review → testing → done + blocked + on-hold | Full board |

Every state has a **category** (open / active / closed) that drives:
- `next` command: filters to open-category tasks
- `report`: progress = closed / total
- `ready`: only surfaces non-closed tasks
- `list --category`: filters by category

Transition rules are optional. When `enforce_transitions: true`, `set-status` rejects invalid moves (with `--force` to override).

---

## Project Styles & Hierarchy

Four hierarchy styles control task nesting depth and type naming:

| Style | Hierarchy | Max Depth |
|-------|-----------|-----------|
| agile-full | Epic → Story → Task → Subtask | 4 |
| story-driven | Story → Task → Subtask | 3 |
| task-only | Task → Subtask | 2 |
| flat | Task (no nesting) | 1 |

The decomposer checks `getChildType()` before expanding — it won't create children beyond the style's max depth.

---

## Technology Choices

| Component | Library | Role |
|-----------|---------|------|
| CLI framework | Commander.js | Command routing, option parsing, subcommands |
| Interactive prompts | @inquirer/prompts | Multi-step wizards, confirmations, selections |
| Template engine | Handlebars | All output rendering (templates + helpers + partials) |
| Terminal rendering | marked + marked-terminal | Markdown → ANSI-styled terminal output |
| Data validation | Zod | Runtime schema validation for tasks, config, API responses |
| YAML handling | js-yaml | All YAML read/write (config, task files, plans) |
| File locking | proper-lockfile | Prevents concurrent write corruption on tasks.json |
| Styling | chalk + cli-table3 | ANSI colors, formatted tables |
| AI provider | GitHub Copilot API | OpenAI-compatible chat completions (scoring, parsing, expansion) |
| Bundler | tsup | Zero-config TypeScript → ESM bundle |
| Testing | Vitest | Fast, TypeScript-native, ESM-compatible |

---

## Key Design Decisions

1. **Pipeline, not monolith.** Each stage (parse, score, decompose, readiness) is a standalone module. The CLI composes them — modules don't import each other horizontally.

2. **Dual-mode scoring.** Every AI feature has a heuristic fallback. The tool works fully offline; Copilot enhances but never gates functionality.

3. **Templates as the display layer.** All output formatting lives in `.hbs` files. TypeScript code produces data; templates produce views. Users can override any template without touching code.

4. **JSON truth, YAML convenience.** `tasks.json` is the canonical store (fast, unambiguous). YAML files are human-friendly projections generated on demand. `sync` merges edits back.

5. **Readiness is computed, never stored.** No stale flags — `recomputeAllReadiness()` runs on every status change and before every `ready`/`next` call.

6. **Global home, clean repos.** All state lives under `~/.agentx-userdata/taskmaster/`. Project repositories contain zero Taskmaster artifacts.

7. **File locking for concurrent safety.** `proper-lockfile` + atomic rename prevents corruption when multiple agents or terminals write to `tasks.json` simultaneously.

8. **Recursive TaskNode.** A single type models all hierarchy levels. Children are just nested `TaskNode[]`. IDs use dotted notation (`T-1.2.3`) to encode the tree path.
