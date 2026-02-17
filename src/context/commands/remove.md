Remove Task

Arguments: $ARGUMENTS
Remove a task and all its children from the project.

Arguments: $ARGUMENTS (task ID)

## Execution

```bash
npx taskmaster remove $ARGUMENTS
```

## What It Does

1. Finds the task by ID in the task tree
2. Collects all descendant IDs (children, grandchildren, etc.)
3. Removes the task and descendants from the tree
4. Cleans up dangling dependency references in other tasks
5. Recomputes readiness for all remaining tasks

## Confirmation

The command requires confirmation before removing. It shows:
- The task being removed
- Number of child tasks that will also be removed
- Tasks that depend on the removed task

## Important

- Removing a parent removes ALL its children
- Dependencies pointing to removed tasks are automatically cleaned up
- Readiness is recomputed — previously blocked tasks may become unblocked
- This operation modifies tasks.json immediately
