Show Task

Arguments: $ARGUMENTS
Show detailed information for a specific task.

Arguments: $ARGUMENTS (task ID)

## Execution

```bash
npx taskmaster show $ARGUMENTS
```

## Context Display

For the task, show:
- Full description and acceptance criteria
- Current status and priority
- Required skills
- Dependencies (and whether they're satisfied)
- Subtasks (if expanded)
- QA feedback history (if any failures were reported)
- Complexity score

## Argument Handling

- Task ID (e.g., "T-5" or "5"): show that specific task
- "current": show any in-progress tasks
- Multiple IDs: show each task for comparison

## Follow-Up Suggestions

Based on task state:
- Status `pending` + dependencies met -> suggest starting work
- High complexity + no subtasks -> suggest expanding
- Status `qa-failed` -> show failure details and suggest fix approach
- Status `done` -> show dependent tasks now unblocked
