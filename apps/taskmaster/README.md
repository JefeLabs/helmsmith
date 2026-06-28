# AgentX Taskmaster

CLI-based project task generator with complexity scoring and auto-decomposition.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Link the CLI for local development
npm link

# Initialize a project
agentx-taskmaster init --name my-project --no-interactive

# Parse an implementation plan
agentx-taskmaster parse plan.md

# Score tasks by complexity
agentx-taskmaster score --heuristic-only

# Expand high-complexity tasks into subtasks
agentx-taskmaster expand-all

# View ready tasks
agentx-taskmaster ready

# Get the next task to work on
agentx-taskmaster next
```

## Features

- Parse implementation plans from Markdown, text, or YAML files
- Heuristic complexity scoring across five weighted dimensions (scope, depth, dependencies, ambiguity, cross-cutting)
- AI-powered scoring via GitHub Copilot (optional, falls back to heuristic)
- Style-aware task decomposition (agile-full, story-driven, task-only, flat)
- Dependency graph with readiness computation and cycle detection
- Skill tagging with vocabulary validation and AI inference
- Configurable task states with presets (simple, standard, kanban)
- Delegation manifest output for agent workflows
- Handlebars-powered reports and task file generation
- YAML/JSON hybrid format with bidirectional sync
- Multi-project support with isolated state

## Command Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `init` | Interactive project setup | `--name`, `--style`, `--no-interactive` |
| `parse <file>` | Parse a plan into tasks | `--append`, `--force`, `--num-tasks` |
| `score` | Run complexity scoring | `--heuristic-only`, `--all`, `--threshold` |
| `expand <id>` | Decompose a task into subtasks | `--force`, `--max-subtasks` |
| `expand-all` | Expand all tasks above threshold | `--threshold`, `--dry-run` |
| `list` | List tasks with filters | `--status`, `--category`, `--skills`, `--format` |
| `show <id>` | Show task details | `--with-children`, `--format` |
| `set-status <id> <status>` | Update task state | `--cascade`, `--force` |
| `add` | Create a new task | `--title`, `--type`, `--parent`, `--skills` |
| `remove <id>` | Remove a task | `--force` |
| `ready` | Show delegation manifest | `--format`, `--skills` |
| `next` | Show highest-priority ready task | |
| `validate` | Check dependency graph | `--fix` |
| `report` | Generate project report | `--type`, `--format`, `--template` |
| `generate` | Write YAML task files | `--force` |
| `sync` | Merge YAML edits back to JSON | `--dry-run`, `--diff` |
| `config` | Edit project configuration | `--set`, `--get` |
| `auth login` | Authenticate with GitHub Copilot | |
| `auth status` | Show auth status | `--verbose` |
| `auth logout` | Revoke credentials | |
| `projects list` | List all projects | |
| `projects create <name>` | Create a project | `--description` |
| `projects switch <name>` | Set active project | |
| `projects remove <name>` | Remove a project | `--force` |

## Global Flag

All commands accept `--project <name>` to target a specific project without switching the active project.

## Development

```bash
# Run tests
npm test

# Run integration tests only
npm run test:integration

# Run E2E tests only
npm run test:e2e

# Watch mode
npm run test:watch

# Build
npm run build
```

## Architecture

State is stored under `~/.agentx-userdata/taskmaster/` with per-project directories containing `tasks.json`, `config.yaml`, and generated task files. The `AGENTX_USERDATA` environment variable overrides the base directory.

## License

MIT
