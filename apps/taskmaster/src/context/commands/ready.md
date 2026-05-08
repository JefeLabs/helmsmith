Ready Tasks

Arguments: $ARGUMENTS
Show the delegation manifest — all tasks ready for work.

Arguments: $ARGUMENTS

## Execution

```bash
npx taskmaster ready $ARGUMENTS
```

## Output Sections

The ready command shows:
- **Ready tasks**: unblocked, all dependencies satisfied
- **QA-failed tasks**: need immediate fixes (highest priority)
- **Blocked tasks**: waiting on upstream work

## Format Options

- Default: human-readable terminal output
- `--format json`: machine-readable for automation
- `--skill backend`: filter by required skill

## Usage by Role

- **Team Lead**: use to decide what to delegate next
- **Developer**: use to find available work matching your skills
- **QA Lead**: cross-reference with `npx taskmaster report --type qa`

## Priority Order

Tasks are ordered by:
1. QA failures (always first — they block the pipeline)
2. Critical priority
3. High priority
4. Tasks that unblock the most dependents
