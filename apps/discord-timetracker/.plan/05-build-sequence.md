# 05 — Build Sequence

Incremental milestones. Each is independently runnable/testable, so you always
have a working bot and can stop at any milestone with something useful.

## M0 — Project skeleton
- `bun init`, TypeScript strict config, ESLint/Biome.
- Add deps: `discord.js`, `@helmsmith/cli-kit` (+ `commander`, `inquirer` peers),
  `@helmsmith/tui-view-components` (+ `@opentui/core`, `@opentui/react`,
  `react` peers), `zod`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`.
- Link workspace libs (`workspace:*` or `bun link`).
- `src/index.ts` with `createCli()` and a stub `start` command that just logs.
- **Done when:** `bun run src/index.ts --help` lists commands.

## M1 — Config + domain
- `config/schema.ts` (zod): token, guildId, channel IDs, adminRoleId,
  reportChannelId, timezone, storage block.
- `config/load.ts`: merge `timetracker.config.json` + env; validate.
- `domain/types.ts` (`DailyActivity`) + `domain/dayKey.ts` (timezone-aware).
- **Done when:** `loadConfig()` parses a sample config and rejects a bad one
  (unit test); `dayKeyFor()` buckets a 2am timestamp into the right local day.

## M2 — Storage layer (both adapters + contract tests)
- `StorageAdapter` interface, `factory.ts`.
- `SqliteAdapter` (`bun:sqlite`) — full implementation.
- `DynamoAdapter` (`@aws-sdk/lib-dynamodb`) — full implementation.
- **One shared contract test suite** run against both adapters (Dynamo via
  `dynamodb-local`/testcontainers). This is what proves the swap is safe.
- **Done when:** identical test suite passes on SQLite and DynamoDB, including
  concurrent `incrementCi` not losing updates.

## M3 — Bot runtime: message-driven features (2, 4, 5, 6a)
- `bot/client.ts` with intents `Guilds, GuildMessages, MessageContent`.
- `bot/router.ts` dispatching `messageCreate` by channel id; **bots ignored
  except in the CI channel** (GitHub Monitor is a bot).
- Handlers:
  - `startOfDay` (goals channel, first-wins), `endOfDay` (summary, last-wins).
  - `ciSubmission` — parse **every** `PR Actor:` line, resolve github→discord,
    `incrementCi` per mapped human block; skip `Github System`/unlinked.
  - `engagement` — message whose `channelId ∈ voiceChannelIds` →
    `incrementEngagement` (text signal, 6a).
- Wire `start` command to connect + listen.
- **Done when:** posting in each channel writes/updates the right
  `DailyActivity` row; a `PR Actor: Github System` block adds nothing.

## M4 — Presence + voice polling (features 3, 6b)
- Add `GuildPresences`, `GuildMembers`, `GuildVoiceStates` intents;
  `guild.members.fetch()` on ready.
- `bot/poller.ts` on `*/5 * * * *`:
  - presence → `recordPresenceSample` (feature 3).
  - members in any `voiceChannelIds` channel → `incrementVoiceSamples` (6b).
- **Done when:** online users accrue `presence.online`; users sitting in a
  tracked voice channel accrue `engagementVoiceSamples`; others don't.

## M5 — ReportService + non-interactive `report`
- `reports/ReportService.ts` (`daily`, `weekly`) + `reports/types.ts`.
- `cli/report.ts` → text table + `--json`.
- **Done when:** `timetracker report --period weekly --json` emits correct
  aggregates.

## M6 — TUI viewer (`view`)  ← daily/weekly summaries
- `tui/SummaryView.tsx` (Table master/detail, daily↔weekly keybindings, date
  paging), `tui/UserDetailView.tsx`, `tui/runViewer.ts` (`runTuiView` +
  `AppShell`).
- `cli/view.ts` wires it to `ReportService`.
- **Done when:** `timetracker view` opens a navigable daily table, `w`/`d`
  toggles period, ←/→ pages dates, Enter drills into a user.

## M7 — Admin gating + scheduled Discord summaries
- Slash commands `/report`, `/status` gated to `adminRoleId`, ephemeral replies.
- Scheduled push of daily (e.g. 09:00) + weekly (Mon) summaries to
  `reportChannelId`.
- **Done when:** non-admins can't invoke; summaries appear in the admin channel
  on schedule.

## M8 — Identity linking + CI attribution polish
- `cli/link.ts` (inquirer) populates `identity_map`.
- `GithubMapAttributor` fallback in `ciSubmission`.
- **Done when:** a CI message with a GitHub author maps to the right Discord
  user.

## M9 — Hardening for local run
- Graceful shutdown (flush, close adapter), reconnect handling, structured
  logging, `.env.example`, README run instructions.
- **Done when:** `bun run start` survives a network blip and a Ctrl-C cleanly.

## Later (AWS) — not in v1
- Provision DynamoDB table + GSI via CDK/Terraform.
- Containerize; deploy to ECS Fargate (always-on task).
- Token/secrets via AWS Secrets Manager; swap `noopAuthProvider` for real auth.
- Flip `STORAGE_BACKEND=dynamodb`. No app code change.

---

### Suggested order rationale
Storage (M2) before features (M3+) so handlers write to a tested sink. Message
features (M3) before presence (M4) because they're simpler and don't need
privileged-intent setup. ReportService (M5) before TUI (M6) so the TUI consumes
a finished, tested read model. Admin gating (M7) last among core work since it's
a policy layer over working features.
