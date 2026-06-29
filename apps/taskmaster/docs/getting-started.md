# Getting Started — taskmaster

This guide takes you from zero to a working taskmaster project in
about 10 minutes. The end state: a parsed implementation plan, scored
tasks, decomposed subtasks, and a `next` queue you can hand to an
agent.

## Prerequisites

- **Node.js ≥ 22**. Check with `node --version`.
- An implementation plan you want to convert into tasks. Markdown,
  plain text, or YAML formats work. (You can also start from scratch
  and add tasks manually.)
- (Optional) A GitHub account with Copilot access if you want
  AI-driven complexity scoring. Heuristic scoring works without it.

## 1. Install

```bash
npm install -g @jefelabs/taskmaster
```

Verify:

```bash
agentx-taskmaster --version
# Should print the installed version
```

If you see "command not found", the npm global bin isn't on your
`PATH`. Add `$(npm bin -g)` or use `npx agentx-taskmaster …`.

## 2. Initialize a project

```bash
agentx-taskmaster init
```

Interactive prompts walk you through:

- **Project name** (used as the project directory name)
- **Decomposition style**: agile-full, story-driven, task-only, flat
- **Status preset**: simple, standard, kanban
- **Skills vocabulary** (optional)

Or non-interactive:

```bash
agentx-taskmaster init --name my-project --style story-driven --no-interactive
```

This creates `~/.agentx-userdata/taskmaster/my-project/` with:

- `tasks.json` — the structured task tree (initially empty)
- `config.yaml` — your project's settings
- `tasks/` — directory for individual task YAML files (created by
  `generate`)

Override the userdata location with `AGENTX_USERDATA=/custom/path` if
you need a non-default storage root.

## 3. Authenticate (optional)

If you want AI-driven complexity scoring or skill inference, log in
with GitHub Copilot:

```bash
agentx-taskmaster auth login
```

This runs Device Flow and persists the token. Without auth, taskmaster
falls back to heuristic-only scoring — fully functional, just less
nuanced.

```bash
agentx-taskmaster auth status
```

## 4. Parse a plan

If you have an implementation plan in Markdown:

```bash
agentx-taskmaster parse plan.md
```

The parser:

- Extracts top-level sections as Epics
- Subsections as Stories or Tasks (depending on decomposition style)
- Preserves descriptions, acceptance criteria (when formatted as
  bullet lists), and any front-matter metadata

Verify:

```bash
agentx-taskmaster list
```

Output shows the parsed task hierarchy with IDs, types, and current
statuses (typically `pending`).

### Append vs replace

```bash
agentx-taskmaster parse plan2.md --append    # adds to existing tasks
agentx-taskmaster parse plan-rewrite.md --force   # replaces all tasks
```

### Targeted parsing

```bash
agentx-taskmaster parse plan.md --num-tasks 5
# Only parse the first 5 sections — useful for focused scoping
```

## 5. Score complexity

```bash
agentx-taskmaster score --heuristic-only
# Heuristic scoring across 5 weighted dimensions:
#   - Scope (how much functional surface)
#   - Depth (technical complexity per unit)
#   - Dependencies (how much else has to land first)
#   - Ambiguity (how clearly defined)
#   - Cross-cutting (impact on shared infrastructure)
```

For AI-driven scoring (uses Copilot if authenticated):

```bash
agentx-taskmaster score
```

Inspect the scored tasks:

```bash
agentx-taskmaster list --format table
```

You'll see a `complexity` column. Tasks above your threshold (default:
7/10) are candidates for decomposition.

## 6. Decompose high-complexity tasks

```bash
agentx-taskmaster expand-all --threshold 7
```

For each task above complexity 7, taskmaster generates subtasks
appropriate to your project's decomposition style. AI-driven
generation if authenticated; template-based otherwise.

To preview without writing:

```bash
agentx-taskmaster expand-all --threshold 7 --dry-run
```

To expand a single task:

```bash
agentx-taskmaster expand TASK-001 --max-subtasks 5
```

## 7. View what's ready to work on

```bash
agentx-taskmaster ready
```

Shows the **delegation manifest** — tasks with all dependencies
satisfied, ranked by priority. This is the output you hand to an
agent (or a teammate) and say "pick from here next".

For a single task:

```bash
agentx-taskmaster next
# → highest-priority ready task, formatted for immediate consumption
```

Filter by skill:

```bash
agentx-taskmaster ready --skills frontend,react
```

## 8. Update task state

As work progresses:

```bash
agentx-taskmaster set-status TASK-042 in-progress
agentx-taskmaster set-status TASK-042 done
```

Status values come from your project's preset:

- **simple**: `pending`, `done`
- **standard**: `pending`, `in-progress`, `done`
- **kanban**: `backlog`, `ready`, `in-progress`, `review`, `done`

Cascade status to children:

```bash
agentx-taskmaster set-status TASK-001 done --cascade
```

## 9. Generate per-task YAML files

```bash
agentx-taskmaster generate
```

Writes one YAML file per task to your project's `tasks/` directory.
Each file is human-editable: title, description, acceptance criteria,
skills, dependencies, status. Useful for:

- Code-review-style task review
- Editing many tasks at once via your editor of choice
- Committing task definitions to a separate repo for non-engineers
  to review

After editing, sync back to the structured store:

```bash
agentx-taskmaster sync
agentx-taskmaster sync --diff       # preview changes before applying
agentx-taskmaster sync --dry-run    # preview without applying
```

## 10. Generate reports

```bash
agentx-taskmaster report
agentx-taskmaster report --type progress --format markdown
agentx-taskmaster report --type roadmap --format html
```

Handlebars-driven report templates. Outputs go to stdout (pipe to a
file or commit to your repo's docs/).

## Common workflows

### Manage multiple projects

```bash
agentx-taskmaster projects list
agentx-taskmaster projects create my-other-project
agentx-taskmaster projects switch my-other-project
```

Each project has independent state under `~/.agentx-userdata/taskmaster/`.
Use `--project <name>` on any command to target a specific project
without switching the active one.

### Validate the dependency graph

```bash
agentx-taskmaster validate
agentx-taskmaster validate --fix    # auto-fix common issues
```

Catches:

- Cycles in dependencies
- Tasks marked `blocked` but with no blocking dependency
- Tasks marked `ready` but with unsatisfied dependencies

### Add a new task manually

```bash
agentx-taskmaster add \
  --title "Add OAuth login flow" \
  --type story \
  --parent EPIC-002 \
  --skills auth,frontend \
  --description "..."
```

### Filter `list` aggressively

```bash
agentx-taskmaster list --status pending --skills frontend --format json
agentx-taskmaster list --category bug --format yaml
```

JSON / YAML output is structured for piping to other tools (jq, yq).

### Show one task with children

```bash
agentx-taskmaster show TASK-042 --with-children
```

## Troubleshooting

### "Project not initialized"

Run `agentx-taskmaster init` first. Or, if you have an existing
project, switch to it: `agentx-taskmaster projects switch my-project`.

### "Parser couldn't infer task structure"

Plans in unconventional formats may not parse cleanly. Either:

1. Restructure the plan to match conventional Markdown heading
   hierarchy (H1 = epic, H2 = story, H3 = task)
2. Manually add tasks with `agentx-taskmaster add`
3. Edit the generated `tasks.json` directly (advanced)

### "Score command says 'no AI provider configured'"

Either:

1. Authenticate: `agentx-taskmaster auth login`
2. Use heuristic-only: `agentx-taskmaster score --heuristic-only`

### "Decomposition produced too many subtasks"

Lower the cap:

```bash
agentx-taskmaster expand-all --threshold 7 --max-subtasks 3
```

Or pre-mark specific tasks as already decomposed:

```bash
agentx-taskmaster set-status TASK-042 done   # if it's actually small enough
```

### Reset everything

```bash
rm -rf ~/.agentx-userdata/taskmaster/<project-name>
agentx-taskmaster init               # start over
```

To remove only one project: `agentx-taskmaster projects remove <name>`.

## What's next

- **[feature-overview.md](feature-overview.md)** — full guided tour
  of every command, scoring dimension, and report type.
- **[architecture.md](architecture.md)** — how the parser, scorer,
  decomposer, and readiness engine fit together.
- **[executive-overview.md](executive-overview.md)** — high-level
  framing for sharing with engineering managers.
