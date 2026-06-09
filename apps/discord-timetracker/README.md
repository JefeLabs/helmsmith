# @ecruz165/discord-timetracker

Admin-only Discord bot that passively tracks per-user daily activity and
surfaces it to admins — with a TUI for daily/weekly summaries.

Tracks:
- **Start of day** — first post in `#goals-for-the-day`
- **End of day** — last post in `#summary-of-the-day`
- **Online status** — sampled every 5 minutes
- **CI submissions** — messages in `#ci-cd-notifications`, attributed per user
- **Engagement** — messages in `#DevOffice`, counted per user

Runs locally first (Bun); designed to lift to AWS (ECS Fargate, us-east-1) with
no rewrite via a pluggable storage layer.

## Stack

Bun · TypeScript · discord.js v14 · [`@ecruz165/cli-kit`](../../packages/cli-kit-lib)
(commands) · [`@ecruz165/tui-view-components`](../../packages/tui-view-components-lib)
(TUI) · storage = SQLite (`bun:sqlite`) **or** DynamoDB, chosen by config.

## Develop

```bash
pnpm install                 # from the monorepo root
cp .env.example .env         # fill in token, guild, channel IDs
pnpm --filter @ecruz165/discord-timetracker dev -- --help
```

CLI verbs:

| Verb | Does |
|------|------|
| `setup` | interactive first-run config (token, guild, channels, storage) |
| `start` | run the bot (gateway listener + 5-min poller + scheduler) |
| `view` | daily/weekly summary **TUI** |
| `report` | non-interactive summary (`--period weekly`, `--json`) |
| `link` | map a GitHub username → Discord user (CI attribution) |

## Running the bot

```bash
discord-timetracker setup     # or hand-edit .env + timetracker.config.json
discord-timetracker start     # Ctrl-C for graceful shutdown
```

> ⚠️ **Enable the three privileged intents** in the Discord Developer Portal
> (Bot → Privileged Gateway Intents): **Server Members**, **Presence**, and
> **Message Content**. Without them the bot connects but silently receives empty
> presence/member/message data — the classic "why are all my counters zero."

The bot must run **continuously** to track (it samples presence/voice every 5
min and reacts to messages live). Run it on an always-on host for real use; a
laptop only tracks while awake. Scheduled summaries post to the report channel
at `SCHEDULE_DAILY_AT` and survive restarts (last-run state is persisted).

## Plan

Full design + build sequence lives in [`.plan/`](./.plan/). Start with
[`.plan/README.md`](./.plan/README.md).

**Status: M9 — local v1 complete.** All nine core milestones done: M0 scaffold ·
M1 config + `setup` · M2 pluggable storage · M3 bot runtime · M4 poller · M5
ReportService + `report` · M6 `view` TUI · M7 admin commands + scheduled push ·
M8 `link` + display names · M9 hardening (message-id idempotency across
redelivery, reconnect/error logging, login-failure handling, graceful
shutdown). **Next (post-v1): AWS deploy** — flip `STORAGE_BACKEND=dynamodb`,
containerize, run on ECS Fargate. See `.plan/05-build-sequence.md`.
