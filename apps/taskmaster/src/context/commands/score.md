Score

Arguments: $ARGUMENTS
Score task complexity using heuristic analysis and optional AI.

## Execution

```bash
npx taskmaster score
npx taskmaster score --all
npx taskmaster score --recalculate
npx taskmaster score --heuristic-only
```

## Options

- `--all`: score all tasks (not just unscored ones)
- `--recalculate`: re-score all tasks (alias for --all)
- `--heuristic-only`: skip AI scoring, use heuristics only
- `--threshold <n>`: only show tasks above this complexity score

## Scoring Methods

1. **Blended** (default with AI auth): combines AI scoring with heuristic analysis
2. **Heuristic-only**: analyzes task title, description, dependencies, and skills
3. **AI-only**: uses the configured AI provider for scoring

## Complexity Scale

- **1-3**: Low complexity — straightforward implementation
- **4-6**: Medium complexity — some design decisions required
- **7-8**: High complexity — consider expanding into subtasks
- **9-10**: Very high — should be broken down before implementation

## After Scoring

- Tasks above the expand threshold are candidates for `npx taskmaster expand`
- Tasks above the flag threshold get highlighted in reports
- Use `npx taskmaster expand-all` to auto-expand high-complexity tasks
