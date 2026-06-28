Generate

Arguments: $ARGUMENTS
Regenerate YAML task files from the canonical tasks.json data.

## Execution

```bash
npx taskmaster generate
```

## What It Does

- Reads all tasks from `tasks.json` (the single source of truth)
- Writes individual YAML files to the project's `tasks/` directory
- Each task gets its own `.yaml` file with human-readable formatting

## When to Use

- After making bulk changes to tasks.json
- After parsing a new implementation plan
- After expanding tasks with subtasks
- To refresh YAML files that may be out of sync

## Important

- YAML task files are **projections** — they are generated from tasks.json
- Direct edits to YAML files won't persist unless you run `npx taskmaster sync` first
- The generate command overwrites existing YAML files
