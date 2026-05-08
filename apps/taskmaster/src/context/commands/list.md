List Tasks

Arguments: $ARGUMENTS
List tasks with intelligent filtering based on arguments.

Arguments: $ARGUMENTS

## Execution

```bash
npx taskmaster list $ARGUMENTS
```

## Argument Parsing

Parse arguments to determine filters:
- Status keywords: `pending`, `in-progress`, `done`, `review`, `qa-failed`
- Skill filter: `--skill backend`, `--skill frontend`
- Format: `--format json` for machine-readable output
- No arguments: show all tasks grouped by status

## Examples

- `pending` -> `npx taskmaster list` then filter for pending
- `backend` -> `npx taskmaster list --skill backend`
- `blocked` -> tasks with unmet dependencies
- `ready` -> `npx taskmaster ready` (delegation manifest)

## Display

- Group tasks by status
- Show task ID, title, priority, and required skills
- Highlight QA-failed tasks (they need immediate attention)
- Show dependency status for blocked tasks
