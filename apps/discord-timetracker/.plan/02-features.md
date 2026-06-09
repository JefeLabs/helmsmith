# 02 — Features

Each row maps a requested feature to the Discord mechanism that powers it and
the data it writes. The **channel** column is configurable (stored as a channel
ID in config, not hardcoded by name — names can change, IDs don't).

| # | Feature | Discord mechanism | Channel (config key) | Writes |
|---|---------|-------------------|----------------------|--------|
| 1 | Admin-only visibility | Role-gated slash commands + admin-only report channel | `reportChannelId`, `adminRoleId` | — |
| 2 | Start of day per user | `messageCreate` event | `#goals-for-the-day` (`goalsChannelId`) | `DailyActivity.startOfDay` |
| 3 | Online status every 5 min | scheduled presence poll | n/a (whole guild) | `DailyActivity.presence` |
| 4 | End of day per user | `messageCreate` event | `#summary-of-the-day` (`summaryChannelId`) | `DailyActivity.endOfDay` |
| 5 | CI submissions per user/day | `messageCreate`, parse every `PR Actor:` → github→discord map | `#ci-cd-notifications` (`channels.ci`) | `DailyActivity.ciSubmissions++` per human run |
| 6a | Text engagement per user/day | `messageCreate` in a tracked voice channel's chat | `voiceChannelIds[]` | `DailyActivity.engagementMessages++` |
| 6b | Voice engagement per user/day | 5-min poll of voice membership | `voiceChannelIds[]` | `DailyActivity.engagementVoiceSamples++` |

---

## 1. Admin-only visibility

A Discord bot is always *visible* to every member of the server it's in — you
can't hide its presence. "Only seen by admin" is implemented as:

- **Output isolation:** all summaries/reports post to a single admin-only
  channel (`reportChannelId`) whose Discord permissions restrict read access to
  the admin role. The bot never posts tracking data to public channels.
- **Command gating:** slash commands (`/report`, `/status`, `/link`) check the
  caller has `adminRoleId` (or `PermissionFlagsBits.Administrator`) and reply
  **ephemerally** (only the invoker sees the response).

> ⚠️ Decision needed — see `06-open-questions.md`: is the intent privacy (don't
> let tracked users see their own data) or just tidiness? That changes whether
> tracked users may post in the goals/summary channels at all.

## 2. Start of day — `#goals-for-the-day`

On `messageCreate` in the goals channel:
1. Compute `dayKey = dayKeyFor(message.createdAt, config.timezone)`.
2. Load/create `DailyActivity(userId, dayKey)`.
3. If `startOfDay` is unset, set it (timestamp + content). **First post of the
   day wins** — later posts don't overwrite the start time (they could be
   goal edits; capture strategy is a config flag `startOfDay.firstWins`).

## 3. Online status — every 5 minutes

A `PresencePoller` runs on a 5-minute interval (`node-cron` `*/5 * * * *` or a
`setInterval`). On each tick:
1. For each tracked guild member, read `member.presence?.status`
   (`online` | `idle` | `dnd` | `offline` | `undefined`).
2. Increment `presence.samples`; if status ∈ {online, idle, dnd}, increment
   `presence.online` and update `firstOnlineAt`/`lastOnlineAt`.

> Requires the **`GuildPresences`** privileged intent AND members cached. We
> fetch members on ready (`guild.members.fetch()`); presence arrives via the
> gateway. Online-time ≈ `presence.online * 5 minutes` (sampled, not exact —
> good enough for a daily activity signal).

## 4. End of day — `#summary-of-the-day`

Mirror of feature 2 on the summary channel. **Last post of the day wins** for
`endOfDay` (the final summary is the real end-of-day marker).

## 5. CI submissions — `#ci-cd-notifications`

**Confirmed format (from the live channel).** A bot named **"GitHub Monitor"**
posts plain-text messages. One Discord message may contain **several CI-run
blocks**, each shaped like:

```
Tests completed on push event on  develop.
Project: skoolscout/skoolscout-com
PR Actor: yelisson-skoolscout
```
…or, for a PR event, additionally `PR: <branch> --> <target>` and
`PR Link: https://github.com/.../pull/<n>`.

Attribution = the **`PR Actor:` line → a GitHub username** → the `github→discord`
identity map (`resolveIdentity('github', actor)`, populated by `link`, M8).

Two non-obvious rules from the real data:

1. **`PR Actor: Github System`** (and any other non-human actor) appears often.
   These must **not** count. The identity map is the filter: a system actor is
   never linked to a Discord user, so it resolves to `null` and is skipped.
2. **Multiple runs per message.** Parse **every** `PR Actor:` occurrence
   (global regex on `message.content`), not just one — the 6:17 PM example
   carried a PR-create run *and* a push run in a single message.

```ts
// src/bot/handlers/ciSubmission.ts
// Parse all "PR Actor: <login>" lines; for each, resolve github→discord and,
// on a hit, incrementCi(userId, dayKey). Non-human/unlinked actors → skipped.
const ACTOR_RE = /^PR Actor:\s*(.+?)\s*$/gm;
```

Granularity (per Discord message vs per CI-run block) is a confirmed open
decision — see `06-open-questions.md` Q2.

> The poster is a **bot** (`message.author.bot === true`), so the router's
> "ignore bots" rule must exempt this channel (see Cross-cutting rules).

## 6. Engagement — configurable voice channels

`#DevOffice` is a **voice channel** (so are `TriageRoom`, `ProjectOffice`,
`DesignStudio`). Engagement is tracked across a **configurable subset**
(`config.voiceChannelIds`) and aggregated per user/day into **two** signals:

| Signal | Source | Storage |
|--------|--------|---------|
| **Text messages** | `messageCreate` in any tracked voice channel's embedded chat | `engagementMessages++` |
| **Voice time** | 5-min poll: user connected to any tracked voice channel | `engagementVoiceSamples++` (minutes ≈ × 5) |

A voice channel's embedded text chat shares the **same channel id** as the
voice channel, so one `voiceChannelIds` list drives both: the router treats a
message whose `channelId ∈ voiceChannelIds` as text engagement, and the poller
(M4) samples voice membership of those same channels.

Voice time is **sampled** by the 5-min poller (a tick = "connected now"), like
presence — coarse but stateless/restart-proof. Precise `voiceStateUpdate`
join/leave timing is a later refinement. Aggregated across the subset: time in
DevOffice + TriageRoom is one number, not per-channel.

---

## Cross-cutting rules

- **Ignore bots** (`message.author.bot`) everywhere except where a CI *bot* is
  the legitimate poster (feature 5 — there we read the bot's message but
  attribute to a human).
- **Single guild** assumed for v1 (config has one `guildId`). The data model is
  already keyed only by user/day, so multi-guild is an additive change.
- **Idempotency:** message handlers key off `messageId` where it matters
  (start/end of day) so a gateway redelivery doesn't double-count.
