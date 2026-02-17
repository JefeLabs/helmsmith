Validate

Arguments: $ARGUMENTS
Check the dependency graph for cycles, orphans, and skill issues.

## Execution

```bash
npx taskmaster validate
npx taskmaster validate --fix
```

## Options

- `--fix`: automatically repair detected issues where possible

## Checks Performed

1. **Cycle Detection**: finds circular dependency chains (A → B → C → A)
2. **Orphan References**: dependencies pointing to non-existent task IDs
3. **Skill Vocabulary**: tasks with skills not in the project vocabulary
4. **Self-Dependencies**: tasks that depend on themselves

## Auto-Fix

With `--fix`, the validator can:
- Remove orphan dependency references
- Remove self-dependencies
- Remove unknown skills from tasks
- Recompute readiness after fixes

## When to Use

- After manually editing tasks.json or YAML files
- After importing tasks from external sources
- Before generating a delegation manifest with `npx taskmaster ready`
- As a sanity check before starting a work session

## Output

Reports issues by category with task IDs and descriptions. Returns exit code 0 if no issues found, 1 if issues remain after validation.
