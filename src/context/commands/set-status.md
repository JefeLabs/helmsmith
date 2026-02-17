Set Status

Arguments: $ARGUMENTS
Update a task's status in the pipeline.

Arguments: $ARGUMENTS (task ID and status)

## Execution

```bash
npx taskmaster set-status $ARGUMENTS
```

## Argument Parsing

Expected format: `<id> <status>`
- `T-5 in-progress` -> `npx taskmaster set-status T-5 in-progress`
- `T-5 done` -> `npx taskmaster set-status T-5 done`

## Pre-Transition Checks

Before changing status:
1. Verify the transition is valid for the current state preset
2. For `done`: confirm tests pass first
3. For `in-progress`: check that dependencies are satisfied
4. Show what the status change will trigger (e.g., unblocking dependents)

## Common Transitions

- `pending` -> `in-progress`: starting work
- `in-progress` -> `done`: work complete, tests pass
- `in-progress` -> `review`: ready for code review
- `done` -> `qa-failed`: QA found issues (use `npx taskmaster qa-fail` instead)
