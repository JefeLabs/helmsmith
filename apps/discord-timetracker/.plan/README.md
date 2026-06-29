# Discord Time Tracker — Implementation Plan

A Discord bot that passively tracks team activity (start/end of day, online
presence, CI submissions, channel engagement) and reports it to admins.

Runs **locally first**, designed to lift-and-shift to **AWS** later with no
rewrite — achieved through a pluggable storage layer (SQLite now, DynamoDB
later) and externalized config.

## Plan documents

| File | Purpose |
|------|---------|
| [`01-overview.md`](./01-overview.md) | Goals, stack, high-level architecture, repo layout |
| [`02-features.md`](./02-features.md) | Each tracked feature → Discord mechanism → data captured |
| [`03-storage.md`](./03-storage.md) | The pluggable `StorageAdapter` port + SQLite/DynamoDB adapters |
| [`04-cli.md`](./04-cli.md) | commander.js command surface + inquirer.js interactive flows |
| [`05-build-sequence.md`](./05-build-sequence.md) | Ordered, incremental milestones to build it |
| [`06-open-questions.md`](./06-open-questions.md) | Decisions still needed before/while building |

## TL;DR stack

- **Runtime:** **Bun** + TypeScript (strict). Code stays runtime-agnostic where
  the shared libs require it; SQLite uses Bun's built-in driver.
- **Discord:** discord.js v14 (Gateway intents: `Guilds`, `GuildMessages`,
  `MessageContent`, `GuildPresences`, `GuildMembers`)
- **CLI:** [`@helmsmith/cli-kit`](../../agentx-toolbox/packages/cli-kit-lib)
  `createCli()` (commander + inquirer + pluggable auth) — peer deps
  `commander`, `inquirer`
- **TUI:** [`@helmsmith/tui-view-components`](../../agentx-toolbox/packages/tui-view-components-lib)
  (`runTuiView`, `AppShell`, `StatusList`, `Table`, `Menu`) for the live admin
  dashboard — peer deps `@opentui/core`, `@opentui/react`, `react`
- **Storage:** `StorageAdapter` interface → `SqliteAdapter` (default,
  `bun:sqlite`) or `DynamoAdapter` (`@aws-sdk/lib-dynamodb`)
- **Scheduling:** in-process interval / `node-cron` for the 5-min presence poll
- **Config/validation:** Bun env (`Bun.env`) / `dotenv` + `zod`

## Leveraged workspace libraries

This bot is an **AgentX toolbox app** and consumes the shared ecosystem libs
rather than re-wiring CLI/TUI from scratch:

| Lib | Used for | Key API |
|-----|----------|---------|
| `@helmsmith/cli-kit` | the whole CLI bootstrap + interactive prompts + auth | `createCli({ name, version, auth })` → `{ program, auth }` |
| `@helmsmith/tui-view-components` | live admin status dashboard (full-screen) | `runTuiView()`, `AppShell`, `StatusList`, `Table`, `Menu`, `useTheme` |
