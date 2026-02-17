Projects

Arguments: $ARGUMENTS
Manage multiple taskmaster projects.

Arguments: $ARGUMENTS (subcommand: list, create, switch, remove)

## Subcommands

### List

List all projects with active marker:

```bash
npx taskmaster projects list
```

Shows projects from both repo-local and global home locations.

### Create

Create a new project:

```bash
npx taskmaster projects create <name>
npx taskmaster projects create <name> --repo
npx taskmaster projects create <name> --home
```

- `--repo`: store in repository's `.agentx/` directory
- `--home`: store in global `~/.agentx-userdata/taskmaster/`

### Switch

Set the active project:

```bash
npx taskmaster projects switch <name>
```

Searches repo projects first, then global home.

### Remove

Remove a project from the registry:

```bash
npx taskmaster projects remove <name>
```

## Multi-Project Workflow

- Each project has its own tasks.json, config, and task files
- Only one project is active at a time
- Commands operate on the active project
- Use `projects switch` to change context between projects
