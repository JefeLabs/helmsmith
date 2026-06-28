# AgentX Taskmaster — Feature Tour

A hands-on walkthrough of every major capability. Follow along in order for the full experience, or jump to any section that interests you.

---

## Table of Contents

1. [Installation & First Run](#1-installation--first-run)
2. [Project Setup (init)](#2-project-setup)
3. [Multi-Project Management](#3-multi-project-management)
4. [Parsing Implementation Plans](#4-parsing-implementation-plans)
5. [Complexity Scoring](#5-complexity-scoring)
6. [Task Decomposition](#6-task-decomposition)
7. [Task Management (CRUD)](#7-task-management)
8. [Configurable Task States](#8-configurable-task-states)
9. [Dependency Graph & Validation](#9-dependency-graph--validation)
10. [Readiness & Delegation](#10-readiness--delegation)
11. [Skill Tagging](#11-skill-tagging)
12. [Reports & Visualization](#12-reports--visualization)
13. [YAML/JSON Hybrid Format](#13-yamljson-hybrid-format)
14. [GitHub Copilot Integration](#14-github-copilot-integration)
15. [CI/CD & Non-Interactive Mode](#15-cicd--non-interactive-mode)
16. [Template Customization](#16-template-customization)

---

## 1. Installation & First Run

```bash
# Clone and install
git clone <repo-url> && cd agentx-taskmaster
npm install

# Build the CLI
npm run build

# Link globally for local development
npm link

# Verify it works
agentx-taskmaster --help
```

All runtime state lives in `~/.agentx-userdata/taskmaster/` — your repositories stay clean with no dotfolders.

---

## 2. Project Setup

The `init` command launches an interactive wizard that walks you through every configuration choice. On first run, it prompts for everything. On subsequent runs, your previous selections appear as pre-selected defaults — just press Enter to accept.

```bash
agentx-taskmaster init
```

The wizard prompts for:

| Step | What You Choose | Why It Matters |
|------|----------------|----------------|
| **Project name** | e.g., `api-backend` | Creates an isolated workspace under `~/.agentx-userdata/taskmaster/api-backend/` |
| **Project style** | `agile-full`, `story-driven`, `task-only`, or `flat` | Controls hierarchy depth and naming (Epic > Story > Task > Subtask, or simpler) |
| **Status preset** | `simple`, `standard`, `kanban`, or `custom` | Defines available task states and transition rules |
| **Skill vocabulary** | e.g., `backend`, `frontend`, `database` | Skills that can be assigned to tasks for agent delegation |
| **AI model** | e.g., `claude-sonnet-4-20250514`, `gpt-4o` | Used for AI-powered scoring and expansion (requires Copilot auth) |
| **Thresholds** | Expand threshold (default 5), flag threshold (default 8) | Controls which complexity scores trigger auto-expansion or review flags |

For scripting or CI, skip the wizard entirely:

```bash
agentx-taskmaster init --name api-backend --style task-only --no-interactive
```

**Smart defaults**: Every selection is saved to `~/.agentx-userdata/taskmaster/defaults.yaml`. Next time you create a project, your last choices are pre-selected. The tool learns your preferences over time.

---

## 3. Multi-Project Management

Taskmaster supports multiple projects with fully isolated state. One project is "active" at a time, and every command targets it by default.

```bash
# Create additional projects
agentx-taskmaster projects create mobile-app --description "React Native client"
agentx-taskmaster projects create auth-service

# List all projects
agentx-taskmaster projects list

# Switch the active project
agentx-taskmaster projects switch mobile-app

# Target a specific project without switching
agentx-taskmaster list --project api-backend

# Remove a project (prompts for confirmation)
agentx-taskmaster projects remove auth-service
```

Each project gets its own directory under `~/.agentx-userdata/taskmaster/<project>/` with isolated `tasks.json`, `config.yaml`, task files, and templates. The `AGENTX_USERDATA` environment variable overrides the base directory for team sharing or CI environments.

---

## 4. Parsing Implementation Plans

Feed any implementation plan into Taskmaster and it generates a structured task hierarchy.

### Supported Formats

```bash
# Markdown (most common)
agentx-taskmaster parse plan.md

# YAML with structured metadata
agentx-taskmaster parse features.yaml

# Plain text
agentx-taskmaster parse notes.txt
```

The parser auto-detects the format and extracts:
- Headings → task groups
- Bullet points → individual tasks
- Numbered lists → ordered subtasks
- Frontmatter → metadata (priority, tags, dependencies)

### AI-Enhanced Parsing

When authenticated with GitHub Copilot, the parser uses AI to intelligently extract tasks from unstructured documents — catching context that structural parsing alone would miss. It falls back to the heuristic parser when AI is unavailable.

### Incremental Parsing (--append)

Already have tasks? Append new ones from a follow-up PRD without disrupting existing state:

```bash
agentx-taskmaster parse features-v2.md --append
```

Append mode:
- Preserves all existing tasks, statuses, scores, and dependencies
- Auto-increments IDs from the highest existing ID
- Infers cross-dependencies between new and existing tasks
- Flags inferred dependencies for review via `validate`

Without `--append`, parsing replaces the task set entirely (requires `--force` if tasks already exist).

---

## 5. Complexity Scoring

Every task gets scored on a 1–10 scale across five weighted dimensions.

```bash
# Score all unscored tasks
agentx-taskmaster score

# Re-score everything
agentx-taskmaster score --all --recalculate

# Heuristic-only (no AI, works offline)
agentx-taskmaster score --heuristic-only

# Machine-readable output
agentx-taskmaster score --format json
```

### Scoring Dimensions

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| **Scope Breadth** | 20% | Number of distinct concerns, features, or components |
| **Technical Depth** | 25% | Infrastructure, security, performance, or integration work |
| **Dependency Count** | 15% | How many other tasks this item interacts with |
| **Ambiguity** | 20% | Vagueness of requirements — fewer specifics = higher complexity |
| **Cross-Cutting** | 20% | Whether the task spans multiple modules or systems |

### Score Thresholds

| Score | Label | Action |
|-------|-------|--------|
| 1–3 | Low | Implementation-ready as-is |
| 4–6 | Medium | Auto-expanded into 3–5 subtasks |
| 7–10 | High | Auto-expanded into 5–10 subtasks; flagged for review |

When Copilot is authenticated, the AI scorer refines the heuristic result by analyzing the task in context. The final score blends both signals.

---

## 6. Task Decomposition

High-complexity tasks are automatically broken down into actionable subtasks.

```bash
# Expand a single task
agentx-taskmaster expand T-5

# Expand all tasks above the threshold
agentx-taskmaster expand-all

# Preview what would be expanded (no changes)
agentx-taskmaster expand-all --dry-run

# Override the threshold
agentx-taskmaster expand-all --threshold 4

# Control subtask count
agentx-taskmaster expand T-5 --max-subtasks 8
```

### Style-Aware Expansion

Expansion respects your project's hierarchy style:

| Style | Max Depth | Expansion Behavior |
|-------|-----------|-------------------|
| `agile-full` | 4 | Epic → Story → Task → Subtask |
| `story-driven` | 3 | Story → Task → Subtask |
| `task-only` | 2 | Task → Subtask |
| `flat` | 1 | No expansion (tasks only) |

Subtasks inherit the parent's required skills by default, with AI refinement adding subtask-specific skills when available.

---

## 7. Task Management

Full CRUD operations with interactive prompts and flag-based equivalents.

### Listing Tasks

```bash
# List all tasks
agentx-taskmaster list

# Filter by status
agentx-taskmaster list --status in-progress

# Filter by category (open, active, closed)
agentx-taskmaster list --category active

# Filter by required skills
agentx-taskmaster list --skills backend,database

# Compact view
agentx-taskmaster list --compact

# Machine-readable
agentx-taskmaster list --format json
```

### Viewing Task Details

```bash
# Show full details for a task
agentx-taskmaster show T-5

# Include the full subtask tree
agentx-taskmaster show T-5 --with-children
```

### Adding Tasks

```bash
# Interactive guided creation
agentx-taskmaster add

# Flag-based creation
agentx-taskmaster add task --title "Add rate limiting" --priority high --skills backend,api-design
```

The interactive prompt walks through: title, type (based on style), priority, required skills (from your vocabulary), parent task, and tags.

### Removing Tasks

```bash
# Remove with confirmation prompt
agentx-taskmaster remove T-12

# Skip confirmation
agentx-taskmaster remove T-12 --force
```

Removal cascades to children and cleans up any dependency references pointing to the removed task.

### Updating Status

```bash
# Set a task's status
agentx-taskmaster set-status T-3 done

# Cascade status to all children
agentx-taskmaster set-status T-3 done --cascade

# Bypass transition rules
agentx-taskmaster set-status T-3 done --force
```

---

## 8. Configurable Task States

Task states are fully customizable per project. Choose a preset during `init` or define your own.

### Built-in Presets

**Simple** (solo projects):
```
todo → in-progress → done
```

**Standard** (small-to-mid teams):
```
backlog → todo → in-progress → review → done
                                          + blocked
```

**Kanban** (continuous delivery):
```
backlog → ready → in-progress → review → testing → done
                                          + blocked + on-hold
```

### Custom States

Define your own in `config.yaml`:

```yaml
states:
  preset: custom
  custom:
    - { name: draft, category: open }
    - { name: approved, category: open, transitions: [in-dev] }
    - { name: in-dev, category: active, transitions: [qa, blocked] }
    - { name: qa, category: active, transitions: [done, in-dev] }
    - { name: done, category: closed }
  enforce_transitions: true
```

### State Categories

Every state belongs to a category that drives behavior:

| Category | Effect |
|----------|--------|
| **open** | Eligible for `next` command; counts toward backlog |
| **active** | Shown in active work summaries; blocks parent from closing |
| **closed** | Excluded from `next`; counts toward progress percentage |

When `enforce_transitions` is true, `set-status` rejects invalid state changes with a helpful error showing allowed transitions. Use `--force` to bypass.

---

## 9. Dependency Graph & Validation

Tasks can declare dependencies that define execution order and control readiness.

### Dependency Types

| Type | Meaning | Affects Readiness? |
|------|---------|-------------------|
| `blocks` | Must complete before this task can start | Yes |
| `produces` | Generates an output this task consumes | Yes |
| `relates` | Informational link | No |

### Validation

```bash
# Check the entire dependency graph
agentx-taskmaster validate

# Auto-fix detected issues
agentx-taskmaster validate --fix
```

The validator catches:
- **Circular dependencies** — cycles in the task graph
- **Dangling references** — dependencies pointing to non-existent tasks
- **Unknown skills** — skills not in the project vocabulary (with closest-match suggestions)
- **Orphaned tasks** — tasks with no path to any root

Cross-dependencies inferred during `parse --append` are flagged for review here.

---

## 10. Readiness & Delegation

Readiness is **computed, never set manually**. It's recalculated whenever any task's status changes.

### How Readiness Works

| State | Condition |
|-------|-----------|
| **ready** | All `blocks` and `produces` dependencies are in a closed state |
| **blocked** | One or more dependencies are not closed |
| **pending** | No dependencies — immediately ready |

### The Delegation Manifest

The `ready` command outputs everything a Team Lead agent needs to assign work:

```bash
# Terminal display
agentx-taskmaster ready

# Machine-readable for agent workflows
agentx-taskmaster ready --format json

# Filter by skill
agentx-taskmaster ready --skills backend
```

The manifest includes:
- **Ready tasks** with required skills, complexity, priority, and outputs
- **Blocked tasks** with `waiting_on` showing which incomplete dependencies are in the way
- **Summary** with total, ready, blocked, in-progress, and completed counts

### The Next Task

```bash
agentx-taskmaster next
```

Returns the single highest-priority ready task with all context needed for immediate execution. This is the primary command a Team Lead agent calls to decide what to delegate next.

---

## 11. Skill Tagging

Every task carries a `requiredSkills` array used by the Team Lead to match tasks to the right agent persona.

### How Skills Are Assigned

| Method | When | How |
|--------|------|-----|
| **AI-inferred** | During `parse` and `expand` | AI analyzes task content against the skill vocabulary |
| **Manual** | Via `add` or `config` | User explicitly sets skills on a task |
| **Inherited** | During `expand` | Subtasks inherit parent skills; AI may refine |

### Skill Vocabulary

Defined in your project's `config.yaml`:

```yaml
skills:
  vocabulary:
    - backend
    - frontend
    - database
    - devops
    - auth
    - testing
    - api-design
    - ui-ux
  auto_infer: true
```

The `validate` command warns when a task uses a skill not in the vocabulary and suggests the closest match.

### Filtering by Skill

```bash
# List tasks requiring specific skills
agentx-taskmaster list --skills frontend,ui-ux

# Delegation manifest filtered by skill
agentx-taskmaster ready --skills backend
```

---

## 12. Reports & Visualization

Four built-in report types, all rendered through Handlebars templates.

```bash
# Summary report (default)
agentx-taskmaster report

# Specific report type
agentx-taskmaster report --type complexity
agentx-taskmaster report --type progress
agentx-taskmaster report --type dependencies

# Output formats
agentx-taskmaster report --format json
agentx-taskmaster report --format yaml
agentx-taskmaster report --format md

# Use a custom template
agentx-taskmaster report --template my-custom-report
```

### Report Types

| Type | What It Shows |
|------|--------------|
| **summary** | Overview of project status, task counts, and key metrics |
| **complexity** | Score distribution with color-coded bands and expansion recommendations |
| **progress** | Status distribution, completion percentage, and blocked task alerts |
| **dependencies** | Mermaid-syntax DAG visualization of task dependencies |

### Terminal Rendering

When output targets the terminal, reports render through the **marked-terminal pipeline**: Handlebars produces markdown, then `marked` + `marked-terminal` converts it to ANSI-styled output with colored headings, bold status badges, formatted tables, and syntax highlighting.

---

## 13. YAML/JSON Hybrid Format

Taskmaster uses a hybrid data strategy: **JSON for machines, YAML for humans**.

| File | Format | Purpose |
|------|--------|---------|
| `tasks.json` | JSON | Canonical data store — single source of truth |
| `config.yaml` | YAML | Human-editable configuration with comments |
| `tasks/*.yaml` | YAML | Per-task files for human review and editing |

### Generating YAML Task Files

```bash
# Write individual YAML files from tasks.json
agentx-taskmaster generate

# Overwrite existing files
agentx-taskmaster generate --force
```

This creates one `.yaml` file per task in `~/.agentx-userdata/taskmaster/<project>/tasks/`.

### Syncing Edits Back

Edit a YAML task file in your editor, then merge changes back into `tasks.json`:

```bash
# Preview what would change
agentx-taskmaster sync --dry-run

# Show a diff of changes
agentx-taskmaster sync --diff

# Apply changes
agentx-taskmaster sync
```

The sync command detects edits in YAML files and patches `tasks.json` with conflict detection. `tasks.json` always remains the source of truth.

---

## 14. GitHub Copilot Integration

AI features (enhanced parsing, scoring refinement, skill inference, subtask generation) are powered by GitHub Copilot. Authentication uses the same OAuth device flow as GitHub CLI.

```bash
# Authenticate
agentx-taskmaster auth login
```

This opens your browser to `github.com/login/device` where you enter a one-time code. Once authorized, the token is stored in `~/.agentx-userdata/taskmaster/auth.json`.

```bash
# Check auth status
agentx-taskmaster auth status
agentx-taskmaster auth status --verbose

# Revoke credentials
agentx-taskmaster auth logout
```

### What AI Enhances

| Feature | Without AI | With AI |
|---------|-----------|---------|
| **Parsing** | Structural heading/bullet extraction | Intelligent extraction from unstructured docs |
| **Scoring** | Heuristic only (keyword + pattern matching) | Blended heuristic + AI analysis |
| **Expansion** | Rule-based subtask generation | Context-aware subtask descriptions |
| **Skill tagging** | Keyword matching against vocabulary | Semantic inference from task content |

All features work without AI — Copilot enhances results but is never required.

### Environment Variables

For CI/CD, set credentials via environment variables instead of the device flow:

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub PAT with Copilot Requests permission |
| `COPILOT_GITHUB_TOKEN` | Alternative (higher precedence) |

---

## 15. CI/CD & Non-Interactive Mode

Every interactive prompt has a flag-based equivalent. The `--no-interactive` flag suppresses all prompts and uses flags or smart defaults.

```bash
# Fully scripted project setup
agentx-taskmaster init --name api-v2 --style task-only --no-interactive

# Parse and score in one pipeline
agentx-taskmaster parse plan.md --no-interactive
agentx-taskmaster score --heuristic-only

# Expand without confirmation prompts
agentx-taskmaster expand-all --force

# Get delegation manifest as JSON for agent consumption
agentx-taskmaster ready --format json
```

When `--no-interactive` is used, the CLI reads from `defaults.yaml` for any missing values. If `defaults.yaml` doesn't exist, it errors with a message to run `init` interactively first.

---

## 16. Template Customization

All output is rendered through Handlebars templates. Override any built-in template by placing a file with the same name in your project's `templates/` directory.

### Built-in Templates

| Template | Used By |
|----------|---------|
| `task-list.hbs` | `list` command |
| `task-detail.hbs` | `show` command |
| `summary-report.hbs` | `report` |
| `complexity-report.hbs` | `report --type complexity` |
| `progress-report.hbs` | `report --type progress` |
| `dependency-graph.hbs` | `report --type dependencies` |

### Overriding a Template

1. Copy the built-in template from `src/templates/` to your project's template directory:
   ```
   ~/.agentx-userdata/taskmaster/<project>/templates/
   ```
2. Edit the copy — your version takes precedence over the built-in.

### Custom Helpers Available

| Helper | Usage | Description |
|--------|-------|-------------|
| `complexity-color` | `{{complexity-color score}}` | ANSI color based on score band |
| `status-badge` | `{{status-badge status}}` | Formatted status indicator |
| `progress-bar` | `{{progress-bar done total}}` | ASCII progress bar |
| `date-format` | `{{date-format date 'YYYY-MM-DD'}}` | Date formatting |
| `pluralize` | `{{pluralize count 'task' 'tasks'}}` | Singular/plural |
| `indent` | `{{indent text level}}` | Indent multiline text |
| `if-gte` | `{{#if-gte complexity 5}}...{{/if-gte}}` | Numeric comparison |

### Using Custom Templates with Commands

```bash
agentx-taskmaster report --template my-custom-report
agentx-taskmaster generate --template my-task-format
```

---

## Putting It All Together

Here's a typical workflow from zero to delegation-ready tasks:

```bash
# 1. Set up
agentx-taskmaster init

# 2. Feed in a plan
agentx-taskmaster parse implementation-plan.md

# 3. Score complexity
agentx-taskmaster score

# 4. Auto-expand complex tasks
agentx-taskmaster expand-all

# 5. Validate the dependency graph
agentx-taskmaster validate

# 6. See what's ready to delegate
agentx-taskmaster ready --format json

# 7. Get the next task for an agent
agentx-taskmaster next

# 8. Mark work as done (triggers readiness recomputation)
agentx-taskmaster set-status T-1 done

# 9. Check progress
agentx-taskmaster report --type progress
```

Each `set-status` call recomputes readiness across the entire dependency graph, so `ready` and `next` always reflect the current state. Multiple CLI sessions and agents can operate against the same project concurrently — file locking prevents corruption.

---

*Built with TypeScript, Commander.js, Inquirer.js, Handlebars.js, and Vitest.*
