Report

Arguments: $ARGUMENTS
Generate a progress or QA report.

Arguments: $ARGUMENTS

## Execution

```bash
npx taskmaster report $ARGUMENTS
```

## Report Types

- Default (no args): progress report showing task completion status
- `--type qa`: QA status with failures, pending reviews, severity breakdown
- `--type progress`: explicit progress report
- `--type dependency`: dependency graph visualization

## Format Options

- Default: rendered markdown in terminal
- `--format json`: machine-readable for automation
- `--format markdown`: raw markdown output

## What Reports Show

**Progress Report:**
- Tasks by status (pending, in-progress, done, etc.)
- Completion percentage
- Blocked task count and reasons
- Skills coverage

**QA Report:**
- All QA-failed tasks with latest feedback
- Tasks tagged `qa-review-needed`
- Summary by severity (critical/major/minor) and test type
