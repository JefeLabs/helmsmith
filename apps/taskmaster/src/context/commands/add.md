Add Task

Arguments: $ARGUMENTS
Create a new task interactively or from flags.

Arguments: $ARGUMENTS (optional: task type like "task", "story", "epic")

## Execution

```bash
npx taskmaster add $ARGUMENTS
```

## Non-Interactive Mode

Create a task directly with flags:

```bash
npx taskmaster add --title "Implement login flow" --type task --priority high --skills "backend,auth"
```

## Options

- `--title <text>`: task title (required for non-interactive)
- `--type <type>`: task type — valid types depend on project style
- `--priority <level>`: critical, high, medium, low
- `--parent <id>`: create as a child of an existing task
- `--skills <list>`: comma-separated skill names

## Interactive Mode

Without `--title`, launches a prompt flow that asks for:
1. Task title
2. Task type (filtered by project style)
3. Priority level
4. Parent task (optional)
5. Required skills (from project vocabulary)

## After Adding

- The task gets the next available ID (or child ID if `--parent` is used)
- Status is set to the project's default status
- Readiness is recomputed for all tasks
- Persist changes with the task store
