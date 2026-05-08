# AgentX Taskmaster — Claude Code Instructions

## Project Overview

AgentX Taskmaster is a CLI-based project task generator that parses implementation plans, scores task complexity, and auto-decomposes work into structured hierarchies. It supports configurable project styles (Epics, Stories, Tasks, Subtasks) and produces delegation-ready output for a Team Lead agent to assign tasks to specialized agent personas.

**Tech Stack**: TypeScript (strict mode), Node.js 20+, Commander.js (CLI), Inquirer.js (prompts), Handlebars.js (templates), js-yaml (YAML), Zod (validation), Vitest (testing), tsup (bundling)

**Implementation Plan**: `.plans/agentx-taskmaster-implementation-plan.md`

**Data Strategy**: YAML for human-facing files (config, task files, reports) — JSON as internal canonical store (`tasks.json`)

**Runtime State**: All state lives under `~/.agentx-userdata/taskmaster/` — repositories stay clean with no dotfolders.

---

## Task Workflow Protocol

All work flows through the **Team Lead Agent**, which reads the implementation plan, identifies parallelism from the task dependency graph, and delegates to specialized sub-agents.

> **Prerequisite:** Enable Agent Teams in Claude Code `settings.json`:
> ```json
> { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
> ```

---

### Phase 0: Team Lead — Triage & Dispatch

The Team Lead is the orchestrator. It never writes application code directly — it reads, plans, delegates, and coordinates.

1. **Read Implementation Plan** — Read `.plans/agentx-taskmaster-implementation-plan.md` and identify the current implementation phase:
   - **Phase 1 (Foundation)**: T-1, T-2, T-3, T-4, T-11, T-12, T-13 — scaffolding, parser, config, states, prompts, templates, data bridge
   - **Phase 2 (Scoring & Skills)**: T-5, T-6, T-9 — heuristic scorer, Copilot AI scorer, skill tagging
   - **Phase 3 (Decomposition & Delegation)**: T-7, T-8, T-10 — decomposer, dependency graph, readiness
   - **Phase 4 (Polish)**: T-14, T-15, T-16 — CRUD commands, reports, testing & docs

2. **Build a dispatch plan** — Using the task dependency graph from the implementation plan (Section 8), determine:

   | Task ID | Title | Agent | Dependencies | Status |
   |---------|-------|-------|-------------|--------|
   | T-1 | Project scaffolding & CLI framework | `scaffold` | none | Ready — dispatch |
   | T-3 | Configuration system | `scaffold` | none | Ready — dispatch |
   | T-2 | Plan parser | `parser` | T-1 (scaffold) | Blocked — wait |
   | T-4 | Task states engine | `state-engine` | T-3 (config) | Blocked — wait |

   **Parallelism rules:**
   - Tasks with **all dependencies complete** → eligible for dispatch
   - Eligible tasks in **different agent domains** → run in parallel as separate teammates
   - Eligible tasks in the **same agent domain** → run sequentially within that teammate
   - Max team size: 3–5 concurrent teammates (coordination overhead grows beyond that)

3. **Spawn teammates** — For each parallelizable task (or group), spawn a teammate:
   - Use the appropriate agent from `.claude/agents/` (see Agent Reference below)
   - Assign the task ID and provide the relevant implementation plan sections
   - Each teammate creates its own worktree:
     ```bash
     git worktree add ../taskmaster-<task-id> -b task/<task-id>-<short-description>
     ```

4. **Track progress** — As tasks complete, identify newly unblocked work and dispatch the next wave.

---

### Phase 1: Teammate — Task Intake

Each teammate (sub-agent) follows this workflow after being spawned by the Team Lead:

1. **Enter Plan Mode** — Use `EnterPlanMode` tool before doing any research or implementation
2. **Read Implementation Plan** — Read `.plans/agentx-taskmaster-implementation-plan.md` and extract sections relevant to the assigned task. Focus on:
   - System architecture and data model (sections 3–4)
   - The specific task and subtask breakdown (sections 8–9)
   - Scoring methodology if the task involves scoring (section 5)
   - CLI command specifications (section 6)
   - Technology stack and dependencies (section 10)
   - Risks and mitigations relevant to the task (section 11)

   Summarize the relevant context you found before proceeding.

---

### Phase 2: Teammate — Discovery & Refinement

Before creating an implementation plan, generate a discovery document with clarifying and refinement questions tailored to the task:

1. **Create discovery document**: `.plans/task-<id>-discovery.md`
2. **Document structure**:
   ```markdown
   # Task <id>: Discovery & Refinement Questions

   ## Task Summary
   [Brief restatement of the task and relevant context from the implementation plan]

   ## Architecture Questions
   - [ ] [Questions about which src/ modules this task interacts with]
   - [ ] [Questions about data model fields and Zod schemas needed]
   - [ ] [Questions about established patterns to follow]

   ## Implementation Questions
   - [ ] [Questions about input/output contracts with other modules]
   - [ ] [Questions about edge cases and error scenarios]
   - [ ] [Questions about Handlebars templates or Inquirer prompts needed]

   ## Integration Questions
   - [ ] [Questions about how this module connects to tasks.json]
   - [ ] [Questions about which CLI commands consume this module]
   - [ ] [Questions about existing tests to model after]

   ## Scope Questions
   - [ ] [Questions about what is explicitly OUT of scope for v1]
   - [ ] [Questions about follow-up tasks that depend on this]
   - [ ] [Questions about minimum viable implementation]
   ```

   **Guidelines:**
   - Only include categories relevant to the task — skip categories that don't apply
   - Questions should be specific to the task, not generic boilerplate
   - Reference concrete file paths, function names, or plan sections where applicable
   - Flag any contradictions or gaps found between the task description and the implementation plan

3. **Present for review**: Share the discovery document and wait for the user to answer before proceeding to Phase 3

---

### Phase 3: Teammate — Implementation Plan Creation

After gathering answers, create a plan document:

1. **Create plan file**: `.plans/task-<id>-plan.md`
2. **Plan structure**:
   ```markdown
   # Task <id>: <title>

   ## Summary
   [One paragraph describing what will be built]

   ## Questions & Answers
   [Document all Q&A from Phase 2]

   ## Implementation Steps
   1. Step with specific file paths and changes
   2. Each step should be atomic and testable

   ## Files to Create/Modify
   - `src/parser/markdown.ts` - purpose
   - `tests/unit/parser/markdown.test.ts` - tests

   ## Test Strategy
   [How this will be verified with Vitest]

   ## Out of Scope
   [Explicitly excluded items]
   ```

3. **Request Review**: Present the plan and ask:
   > "I've created the implementation plan at `.plans/task-<id>-plan.md`. Please review and confirm you're ready to proceed with implementation."

---

### Phase 4: Teammate — Implementation (After Approval Only)

- Only begin after explicit user confirmation
- Follow the approved plan step-by-step
- Run `npx vitest run` to verify tests pass after each logical chunk of work

---

### Phase 5: Team Lead — Coordination & Completion

The Team Lead monitors teammates and manages the pipeline:

1. **Monitor progress** — Check teammate status for completed work
2. **Unblock dependent tasks** — When a teammate finishes, identify newly-ready tasks from the dependency graph
3. **Spawn next wave** — Dispatch newly unblocked tasks to fresh teammates (repeat Phase 0 steps 2–3)
4. **Handle conflicts** — If two teammates need to modify the same file, coordinate sequencing or merge
5. **Merge worktrees** — After review, merge completed task branches back to main:
   ```bash
   git checkout main
   git merge task/<task-id>-<short-description>
   git worktree remove ../taskmaster-<task-id>
   ```

---

## Agent Reference

| Agent | File | Tasks | Owns |
|-------|------|-------|------|
| **Scaffold** | `.claude/agents/scaffold.md` | T-1, T-3 | `bin/`, `src/config/`, `src/utils/`, global home manager |
| **Parser** | `.claude/agents/parser.md` | T-2 | `src/parser/` — MD/TXT/YAML plan parsing, `--append` |
| **State Engine** | `.claude/agents/state-engine.md` | T-4 | State presets, transitions, category filtering in `src/config/` |
| **Scorer** | `.claude/agents/scorer.md` | T-5, T-6 | `src/scorer/`, `src/auth/` — heuristic + Copilot AI scoring |
| **Skill Tagger** | `.claude/agents/skill-tagger.md` | T-9 | `src/skills/` — vocabulary, AI inference, validation |
| **Decomposer** | `.claude/agents/decomposer.md` | T-7 | `src/decomposer/` — style-aware expansion, depth tracking |
| **Dependency Resolver** | `.claude/agents/dependency-resolver.md` | T-8, T-10 | `src/readiness/` — DAG, readiness, delegation manifest |
| **Prompt Builder** | `.claude/agents/prompt-builder.md` | T-11 | `src/prompts/` — Inquirer.js flows, `--no-interactive` bypass |
| **Template Engine** | `.claude/agents/template-engine.md` | T-12 | `src/templates/`, `src/generator/` — Handlebars, marked-terminal |
| **Data Bridge** | `.claude/agents/data-bridge.md` | T-13 | `src/formats/` — YAML/JSON bridge, sync command |
| **CRUD Commands** | `.claude/agents/crud-commands.md` | T-14 | `add`, `remove`, `set-status`, `show` commands |
| **Report Generator** | `.claude/agents/report-generator.md` | T-15 | Report aggregation and Handlebars rendering |
| **Testing** | `.claude/agents/testing.md` | T-16 | `tests/` — unit, integration, E2E with Vitest |

---

## Project Structure

```
agentx-taskmaster/
├── bin/agentx-taskmaster.js       # CLI entry point (Commander.js)
├── src/
│   ├── parser/                    # Plan parsing (MD, TXT, YAML)
│   ├── scorer/                    # Complexity scoring (heuristic + AI)
│   ├── decomposer/                # Task expansion and subtask generation
│   ├── readiness/                 # Dependency resolver, delegation manifest
│   ├── skills/                    # Skill vocabulary, inference, validation
│   ├── auth/                      # GitHub Copilot OAuth, token management
│   ├── prompts/                   # Inquirer.js prompt definitions
│   ├── formats/                   # YAML/JSON bridge (js-yaml)
│   ├── templates/                 # Handlebars .hbs templates
│   │   └── helpers/               # Custom Handlebars helpers
│   ├── generator/                 # Output file generation (Handlebars)
│   ├── config/                    # Project config, styles, state presets
│   └── utils/                     # Shared utilities (logging, file I/O)
├── tests/
│   ├── unit/                      # Unit tests (mirror src/ structure)
│   ├── integration/               # Pipeline tests
│   ├── e2e/                       # CLI invocation tests
│   └── fixtures/                  # Sample plans, configs, expected outputs
├── .claude/agents/                # Agent definitions (12 agents)
└── .plans/                        # Implementation plan and task plans
```

**Runtime state** (not in repo):
```
~/.agentx-userdata/taskmaster/
├── auth.json                      # Copilot OAuth credentials
├── defaults.yaml                  # Smart defaults (last-used-wins)
├── projects.yaml                  # Project registry + active pointer
└── <project>/
    ├── tasks.json                 # Canonical task store (JSON)
    ├── config.yaml                # Project config
    ├── tasks/                     # Generated YAML task files
    ├── templates/                 # User-overridable Handlebars templates
    └── docs/                      # Input plans and reports
```

---

## Coding Standards

### TypeScript
- **Strict mode** enabled — no `any` types unless absolutely necessary
- **ES modules** (ESM) throughout — no CommonJS `require()`
- **Async/await** over callbacks — all I/O operations are async
- Export types from dedicated `.types.ts` files per module
- Use **Zod** for runtime validation of all config, task data, and API responses

### File Conventions
- Source mirrors test structure: `src/parser/markdown.ts` → `tests/unit/parser/markdown.test.ts`
- One module per concern — avoid god files
- Index files (`index.ts`) export public API only

### Data Rules
- `tasks.json` is the **single source of truth** — YAML task files are generated projections
- Config is YAML-first: `config.yaml` with inline comments explaining each setting
- All mutations persist to disk immediately via file locking (`proper-lockfile`)
- AI API payloads and responses are always JSON

### Testing
- **Vitest** for all tests — fast, TypeScript-native, ESM-compatible
- Target **85%+ line coverage** across core modules
- Mock all AI/network calls with fixture responses
- Use temporary directories for file system tests, clean up in `afterEach`

---

## CLI Commands Reference

```bash
# Project management
agentx-taskmaster init                          # Interactive project setup wizard
agentx-taskmaster projects list                 # List all projects
agentx-taskmaster projects create <name>        # Create new project
agentx-taskmaster projects switch <name>        # Set active project

# Plan parsing
agentx-taskmaster parse <file>                  # Parse plan into tasks
agentx-taskmaster parse <file> --append         # Add tasks to existing project

# Scoring & expansion
agentx-taskmaster score                         # Score unscored tasks
agentx-taskmaster expand <id>                   # Decompose a task into subtasks
agentx-taskmaster expand-all                    # Expand all above threshold

# Task management
agentx-taskmaster list                          # List all tasks
agentx-taskmaster show <id>                     # Full task details
agentx-taskmaster add                           # Interactive task creation
agentx-taskmaster remove <id>                   # Remove task + children
agentx-taskmaster set-status <id> <status>      # Update task state

# Delegation & readiness
agentx-taskmaster ready                         # Delegation manifest (ready tasks)
agentx-taskmaster ready --format json           # Machine-readable for Team Lead
agentx-taskmaster next                          # Single highest-priority ready task

# Reports & validation
agentx-taskmaster report                        # Progress report
agentx-taskmaster validate                      # Check dependency graph
agentx-taskmaster generate                      # Regenerate YAML task files
agentx-taskmaster sync                          # Merge YAML edits back to tasks.json

# Authentication
agentx-taskmaster auth login                    # Copilot OAuth device flow
agentx-taskmaster auth status                   # Token validity + subscription info
agentx-taskmaster auth logout                   # Revoke credentials

# Development
npx vitest run                                  # Run all tests
npx vitest run --coverage                       # Tests with coverage report
npx tsup                                        # Build CLI bundle
```

---

## Key Architecture Decisions

1. **Hybrid YAML/JSON** — YAML for files humans touch, JSON for the machine pipeline. `tasks.json` is truth; YAML files are projections.
2. **Global home (`~/.agentx-userdata/taskmaster/`)** — Repos stay clean. All state is user-local. Multi-project via `projects.yaml`.
3. **Configurable states** — Presets (simple, standard, kanban) or fully custom. State categories (open/active/closed) drive readiness and reporting.
4. **Readiness is computed, never set** — Derived from dependency graph on every status change. Team Lead reads `ready --format json`.
5. **Handlebars for all output** — Templates produce markdown, `marked-terminal` renders to ANSI. User-overridable templates in project's `templates/` dir.
6. **Inquirer.js for all interaction** — Every interactive prompt has a `--no-interactive` flag-based equivalent for CI/CD.
7. **File locking** — `proper-lockfile` prevents corruption from concurrent CLI/agent writes to `tasks.json`.

---

## Important Rules

1. **Never skip Plan Mode** for tasks from the implementation plan
2. **Always document Q&A** in a discovery document before implementation
3. **Get explicit approval** before writing code
4. **tasks.json is truth** — never edit YAML task files as primary source; use `sync` to merge edits back
5. **Follow the dependency graph** — respect phase ordering: Foundation → Scoring → Decomposition → Polish
6. **No MCP, no GUI** — v1 is CLI-only, no external service integrations
7. **Test everything** — 85%+ coverage target; mock AI calls; use Vitest
