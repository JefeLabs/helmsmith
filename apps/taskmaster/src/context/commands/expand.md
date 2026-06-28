Expand Task

Arguments: $ARGUMENTS
Break down a task into subtasks for easier implementation.

Arguments: $ARGUMENTS (task ID)

## Execution

```bash
npx taskmaster expand $ARGUMENTS
```

## Expansion Process

1. Read the task details to understand scope
2. Generate subtasks based on project style and complexity
3. Each subtask gets its own ID, description, and skill requirements
4. Dependencies between subtasks are inferred automatically

## When to Expand

- Task complexity score > expand threshold (default: 5)
- Task description covers multiple distinct concerns
- Task would take more than a few hours to implement

## Bulk Expansion

To expand all tasks above the threshold:

```bash
npx taskmaster expand-all
```

## Post-Expansion

After expanding:
1. Review generated subtasks with `npx taskmaster show <id>`
2. Adjust subtask details if needed
3. Work through subtasks in dependency order
4. Parent task completes when all subtasks are done
