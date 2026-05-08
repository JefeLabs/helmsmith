Init

Arguments: $ARGUMENTS
Initialize a new taskmaster project with the interactive setup wizard.

## Execution

```bash
npx taskmaster init
```

## Non-Interactive Mode

```bash
npx taskmaster init --name "my-project" --no-interactive
npx taskmaster init --name "my-project" --style epic-story-task --repo --no-interactive
```

## Options

- `--name <name>`: project name
- `--style <style>`: task-only, story-task, epic-story-task, or full
- `--model <model>`: AI model to use for scoring/parsing
- `--repo`: store project config in the repository (vs. global home)
- `--no-interactive`: skip wizard, use flags and defaults

## Wizard Steps

The interactive wizard walks through:
1. Project name and description
2. Project style (hierarchy depth)
3. Status preset (simple, standard, kanban)
4. AI provider and model selection
5. Skill vocabulary
6. Complexity thresholds
7. Storage location (repo vs. home)
8. AI tool context installation (Claude Code, Copilot, or Codex agents + commands)

## After Init

- Project is created and set as active
- Configuration is written to the chosen location
- Agent context files are installed if selected
- Ready to parse an implementation plan with `npx taskmaster parse <file>`
