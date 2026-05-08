QA Fail

Arguments: $ARGUMENTS
Report a QA test failure on a task.

Arguments: $ARGUMENTS (task ID)

## Execution

```bash
npx taskmaster qa-fail $ARGUMENTS --no-interactive
```

## Required Information

When reporting a failure, include:
- `--test-type <component|integration|api|e2e|unit>`: what kind of test failed
- `--description "..."`: brief description of what broke
- `--severity <critical|major|minor>`: impact level

## Optional Information

- `--cause "..."`: likely root cause based on test output
- `--reporter <name>`: who is reporting

## What Happens Automatically

When a task is QA-failed:
1. Task status changes to `qa-failed`
2. Direct dependents get tagged `qa-review-needed`
3. Any `done` dependents are pulled back for re-review
4. The pipeline blocks downstream work until the fix is verified

## Batch Failures

For multiple failures, use batch mode:

```bash
npx taskmaster qa-fail-batch --file failures.json
```

Always prefer batch over multiple single calls — it processes atomically.
