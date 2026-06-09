# 01 — Overview & Architecture

## Goal

A read-only/observational Discord bot for a single guild (server) that records
per-user daily activity and surfaces it to admins. No user-facing chatter — it
watches channels and presence, writes records, and reports.

## Why these choices

| Decision | Rationale |
|----------|-----------|
| Bun + TypeScript + discord.js v14 | Bun runtime (your call); discord.js is the most mature Discord lib with first-class typed gateway events (`messageCreate`, `presenceUpdate`). Bun gives a built-in SQLite driver and fast startup. |
| Pluggable storage | You want SQLite now, DynamoDB later. A port/adapter boundary makes the swap a config change, not a rewrite. |
| Local-first, AWS-ready | Run `bun run dev` on your laptop today. Same code runs on ECS Fargate / EC2 later — only the storage backend + secret source change. |
| `@ecruz165/cli-kit` | Reuse the ecosystem's `createCli()` (commander + inquirer + pluggable auth) instead of re-wiring. Gives a clean subcommand CLI (`start`, `setup`, `report`, `view`…) and interactive prompts for first-run config. |
| `@ecruz165/tui-view-components` | Reuse the ecosystem's openTUI/React kit for the **TUI summary viewer** — `AppShell`, `Table`, `StatusList`, `Menu`, launched via `runTuiView()` from a CLI handler. |

## High-level architecture

```
        ┌──────────────────────────────────────────────────────┐
        │            CLI  —  @ecruz165/cli-kit createCli()       │
        │   setup · start · view (TUI) · report --json · link    │
        └──────┬────────────────────────────────────┬───────────┘
        start  │                                view │
               ▼                                     ▼
   Discord Gateway ──►  Bot Runtime           TUI Viewer
   (events pushed)      (discord.js Client)    @ecruz165/tui-view-components
        ├─ event router (by channel id)        runTuiView(<AppShell>
        │    ├─ #goals-for-the-day → StartOfDay   <SummaryView/>  ← daily
        │    ├─ #summary-of-the-day→ EndOfDay      </AppShell>)   ← weekly
        │    ├─ #ci-cd-notifs     → CiSubmission (parse PR Actor:×N)
        │    └─ voiceChannelIds   → Engagement(text)    │
        ├─ Poller /5min: presence + voice samples       │
        └─ ReportService (Discord admin summaries)      │
               │                                        │
               ▼                                        ▼
                   ReportService.daily() / .weekly()
                                 │ (reads)
                                 ▼
                       StorageAdapter (interface)
                          ┌──────────┴───────────┐
                   SqliteAdapter           DynamoAdapter
                  (bun:sqlite)          (@aws-sdk/lib-dynamodb)
                   local file              AWS us-east-1
```

The bot runtime and the TUI viewer both depend **only** on the `StorageAdapter`
interface (via `ReportService`). A factory reads config
(`STORAGE_BACKEND=sqlite|dynamodb`) and injects the right adapter at startup.
Nothing in feature/UI code imports `bun:sqlite` or the AWS SDK directly.

**Two ways to consume reports:** (1) the bot *pushes* daily/weekly summaries to
the admin Discord channel on a schedule; (2) an admin *pulls* them interactively
via the `view` TUI. Both call the same `ReportService` — the read model is
shared, the presentation differs.

## Core domain model

One logical record per **user per day** (the "day" is computed in a configured
timezone so a 2am message still counts toward the right date):

```ts
// src/domain/types.ts
type ISODate = string;        // "2026-06-08"
type UserId  = string;        // Discord snowflake

interface DailyActivity {
  userId: UserId;
  date: ISODate;              // local-tz day key
  startOfDay?: {
    at: string;              // ISO timestamp
    messageId: string;
    goals: string;          // content posted in #goals-for-the-day
  };
  endOfDay?: {
    at: string;
    messageId: string;
    summary: string;        // content posted in #summary-of-the-day
  };
  presence: {
    samples: number;        // total 5-min samples taken
    online: number;         // samples where status was online/idle/dnd
    firstOnlineAt?: string;
    lastOnlineAt?: string;
  };
  ciSubmissions: number;        // human-attributed CI-run blocks (per PR Actor:)
  engagementMessages: number;   // text messages in a tracked voice channel's chat
  engagementVoiceSamples: number; // 5-min ticks connected to a tracked voice channel
  updatedAt: string;
}
```

> Engagement has **two** signals because `#DevOffice` (and `TriageRoom`, …) are
> *voice* channels: text messages in the embedded chat *and* sampled voice-
> connection time. Both aggregate across `config.voiceChannelIds`.

`presence` is stored **aggregated** (a running count) rather than as raw
samples — at 5-min intervals that's 288 samples/user/day, and you only ever
report online-time, so we fold them on write. (If you later want a timeline,
add an append-only `PresenceSample` table — noted in open questions.)

## Repository layout

```
discord-timetracker/
├── .plan/                      # this plan
├── src/
│   ├── index.ts                # CLI entrypoint (commander)
│   ├── config/
│   │   ├── schema.ts           # zod schema for all config
│   │   └── load.ts             # env + config-file merge
│   ├── domain/
│   │   ├── types.ts            # DailyActivity, etc.
│   │   └── dayKey.ts           # timezone-aware date bucketing
│   ├── storage/
│   │   ├── StorageAdapter.ts   # the port (interface)
│   │   ├── factory.ts          # pick adapter from config
│   │   ├── sqlite/SqliteAdapter.ts
│   │   └── dynamo/DynamoAdapter.ts
│   ├── bot/
│   │   ├── client.ts           # discord.js Client + intents
│   │   ├── router.ts           # channel-id → handler dispatch
│   │   ├── handlers/
│   │   │   ├── startOfDay.ts
│   │   │   ├── endOfDay.ts
│   │   │   ├── ciSubmission.ts
│   │   │   └── engagement.ts
│   │   └── presencePoller.ts   # 5-min sampler
│   ├── reports/
│   │   ├── ReportService.ts    # daily/weekly read model (shared by bot + TUI)
│   │   └── types.ts            # DailySummary, WeeklySummary, UserRow
│   ├── tui/                    # @ecruz165/tui-view-components consumers
│   │   ├── SummaryView.tsx     # daily/weekly summary screen (Table + Menu)
│   │   ├── UserDetailView.tsx  # master/detail drill-down for one user
│   │   └── runViewer.ts        # runTuiView() launcher wired to ReportService
│   └── cli/
│       ├── setup.ts            # inquirer first-run wizard (via cli-kit)
│       ├── view.ts             # launches the TUI viewer
│       ├── report.ts           # non-interactive report (--json / stdout)
│       └── link.ts             # map discord user ↔ github/CI identity
├── data/                       # local sqlite file lives here (gitignored)
├── .env.example
├── package.json                # deps: discord.js, @ecruz165/cli-kit,
│                               #   @ecruz165/tui-view-components, zod, aws-sdk
└── tsconfig.json
```

> The bot consumes the workspace libs as peer/workspace dependencies. Locally
> they can be linked via the toolbox workspace (`bun link` /
> `workspace:*`) or installed from the registry once published.
