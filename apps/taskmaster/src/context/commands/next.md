Next Task

Arguments: $ARGUMENTS
Find the highest-priority ready task and prepare to work on it.

Arguments: $ARGUMENTS

## Execution

```bash
npx taskmaster next
```

## Smart Context

After identifying the next task:
1. Show full task details (description, skills, dependencies)
2. Check if any QA failures need fixing first (they take priority)
3. If the task has subtasks, show the first incomplete subtask
4. Suggest setting status to in-progress before starting work

## Argument Handling

- No arguments: highest-priority unblocked task
- "quick": prefer low-complexity tasks
- "important": prefer critical/high priority regardless of complexity

## Follow-Up Actions

Based on the selected task:
- Complex task (score > 5)? Suggest expanding with `npx taskmaster expand <id>`
- Has QA feedback? Show failure details before starting the fix
- Multiple ready tasks? Show alternatives with `npx taskmaster ready`
