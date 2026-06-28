Config

Arguments: $ARGUMENTS
View or modify project configuration settings.

Arguments: $ARGUMENTS (optional: --get <key> or --set <key> <value>)

## Subcommands

### Get

Retrieve a specific configuration value:

```bash
npx taskmaster config --get style
npx taskmaster config --get ai.model
npx taskmaster config --get thresholds.expand
```

### Set

Update a configuration value:

```bash
npx taskmaster config --set style epic-story-task
npx taskmaster config --set ai.model gpt-4.1
npx taskmaster config --set thresholds.expand 7
```

### Interactive Edit

Launch the interactive config editor:

```bash
npx taskmaster config
```

Presents a menu of configurable keys, shows current values, and lets you pick and update one.

## Available Keys

- `style`: project style (task-only, story-task, epic-story-task, full)
- `ai.provider`: AI provider (copilot, openai, anthropic)
- `ai.model`: AI model name
- `thresholds.expand`: auto-expand complexity threshold
- `thresholds.flag`: high-complexity flag threshold
- `skills.vocabulary`: comma-separated skill list
