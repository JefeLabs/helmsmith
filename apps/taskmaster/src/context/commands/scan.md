Scan

Arguments: $ARGUMENTS
Scan a repository to build a capabilities model of the codebase.

Arguments: $ARGUMENTS (optional: path to repository root)

## Execution

```bash
npx taskmaster scan
npx taskmaster scan /path/to/repo
```

## What It Does

1. Walks the repository file tree
2. Discovers components (modules, packages, services)
3. Extracts symbols (functions, classes, types, exports)
4. Identifies entry points (CLI commands, routes, scripts)
5. Detects architectural patterns
6. Auto-detects matching blueprints

## Output

- **Components**: discovered modules with their public surfaces
- **Symbols**: indexed functions, classes, and types by layer
- **Entry Points**: CLI commands, HTTP routes, script entry points
- **Patterns**: detected architectural patterns (MVC, microservices, etc.)
- **Blueprint Matches**: suggested blueprints based on project structure

## Persisted Indexes

When run inside a git repository, scan persists:
- `component-index.json` — component registry
- `symbol-index.json` — symbol lookup table
- `entry-point-index.json` — entry point catalog

These indexes are used by the AI architecture pipeline during `npx taskmaster parse`.
