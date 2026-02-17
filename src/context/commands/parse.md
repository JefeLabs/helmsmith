Parse

Arguments: $ARGUMENTS
Parse an implementation plan into structured tasks.

Arguments: $ARGUMENTS (path to plan file)

## Execution

```bash
npx taskmaster parse $ARGUMENTS
npx taskmaster parse $ARGUMENTS --append
npx taskmaster parse $ARGUMENTS --num-tasks 20
npx taskmaster parse $ARGUMENTS --no-ai
```

## Options

- `--append`: add parsed tasks to existing project (instead of replacing)
- `--num-tasks <n>`: target number of top-level tasks to generate
- `--style <style>`: override project style for this parse
- `--no-ai`: skip AI parsing, use structural parser only
- `--force`: overwrite existing tasks without confirmation
- `--no-scan`: skip codebase scanning during architecture pipeline

## Parse Pipeline

1. **AI Architecture Pipeline** (default): two-phase AI analysis that scans the codebase and generates context-aware tasks
2. **Single-shot AI**: falls back to simpler AI parsing if architecture pipeline fails
3. **Structural Parser**: regex-based fallback when no AI auth is available

## Supported Formats

- Markdown (.md) — headers become task groups
- Plain text (.txt) — numbered lists become tasks
- YAML (.yaml/.yml) — structured task definitions

## After Parsing

- Tasks are written to tasks.json
- Skill inference runs automatically on parsed tasks
- Review with `npx taskmaster list` and `npx taskmaster show <id>`
- Score tasks with `npx taskmaster score`
