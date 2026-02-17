Blueprint

Arguments: $ARGUMENTS
Manage project blueprints for structured concern coverage.

Arguments: $ARGUMENTS (subcommand: list, show, apply, check)

## Subcommands

### List

List all available blueprint archetypes:

```bash
npx taskmaster blueprint list
```

### Show

Show details of a specific blueprint:

```bash
npx taskmaster blueprint show <id>
npx taskmaster blueprint show <id> --urgency upfront
```

- `--urgency <level>`: filter concerns by urgency (upfront, soon, deferred)

### Apply

Resolve blueprint concerns and generate tasks:

```bash
npx taskmaster blueprint apply <id>
npx taskmaster blueprint apply <id> --flat
npx taskmaster blueprint apply <id> --answers '{"key":"value"}'
```

- `--flat`: generate flat task list instead of grouped hierarchy
- `--answers <json>`: provide context answers as JSON (non-interactive)

### Check

Verify task coverage against the configured blueprint:

```bash
npx taskmaster blueprint check
```

Shows which blueprint concerns are covered by existing tasks and which are missing.

## How Blueprints Work

Blueprints define architectural concerns for a project type (CLI tool, web app, library, etc.). Each concern has an urgency level:
- **upfront**: must be addressed before implementation
- **soon**: should be addressed early
- **deferred**: can wait until later phases
