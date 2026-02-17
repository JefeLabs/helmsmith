QA Clear

Arguments: $ARGUMENTS
Clear a QA block after verifying the fix.

Arguments: $ARGUMENTS (task ID)

## Execution

```bash
npx taskmaster qa-clear $ARGUMENTS --note "Tests pass after fix"
```

## Pre-Clear Checklist

Before clearing a QA block:
1. Pull the latest code with the fix
2. Re-run the specific tests that failed
3. Run the full test suite to check for regressions
4. Only clear if ALL tests pass

## Options

- `--note "..."`: describe what was verified
- `--reporter <name>`: who verified

## Batch Clearing

For multiple dependents after a root cause fix:

```bash
npx taskmaster qa-clear-batch <id1> <id2> <id3> --note "Impact reviewed, all pass"
```

## Important

Never clear a QA block without actually running tests. The `qa-clear` command removes the `qa-review-needed` tag and unblocks dependents — false clears will propagate bugs downstream.
