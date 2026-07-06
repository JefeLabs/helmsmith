# 06 — Open Questions & Decisions

Resolve these before (or during) the milestone noted. Defaults are chosen so you
can start building without blocking.

## Decided

| # | Question | Decision |
|---|----------|----------|
| D1 | Language/framework | **TypeScript + discord.js v14** |
| D2 | Runtime | **Bun** (run locally first) |
| D3 | Storage v1 / alt | **SQLite (`bun:sqlite`) default; DynamoDB alternative**, chosen by config |
| D4 | CLI/prompts | **`@helmsmith/cli-kit`** (`createCli` = commander + inquirer + auth) |
| D5 | Summaries UI | **TUI viewer** via `@helmsmith/tui-view-components` (daily + weekly) |
| D6 | Hosting target | Local now; **AWS (ECS Fargate, us-east-1) later**, no rewrite |
| D7 | CI attribution (was Q2) | Parse **every** `PR Actor:` line (bot "GitHub Monitor"); github→discord via `link`. Non-human actors (`Github System`) skipped — identity map is the filter |
| D8 | CI counting granularity | **Per CI-run block** — each human-attributed `PR Actor:` block = `ciSubmissions++` |
| D9 | Engagement meaning | **Both** voice time + text messages, two signals (`engagementVoiceSamples`, `engagementMessages`) |
| D10 | Voice scope | **Configurable subset** `voiceChannelIds[]`, aggregated; voice time **sampled** by the 5-min poller |

## Open

### Q1 — "Only seen by admin": privacy or tidiness? (affects M2, M7)
Is the goal that **tracked users must NOT see their own tracked data** (privacy),
or just that reports shouldn't clutter public channels (tidiness)?
- If privacy: the goals/summary channels are still where users post, but all
  *derived* data and reports go only to the admin channel — and the bot must
  never echo stats publicly. Confirm tracked users may still read their own
  posts (they wrote them).
- **Default assumed:** tidiness + privacy of *derived* stats. Reports →
  admin-only channel; commands ephemeral + role-gated.

### Q2 — CI attribution source ✅ RESOLVED (see D7/D8)
Bot **"GitHub Monitor"** posts plain-text messages; attribution is the
`PR Actor:` line (a GitHub username) → `github→discord` map. Parse **every**
`PR Actor:` block (multiple per message); `Github System` and other unmapped
actors are skipped. Each human-attributed block = one CI submission. See
feature 5 in `02-features.md`.

### Q3 — Who is "tracked"? (affects M4)
All non-bot guild members, or an explicit roster (e.g. a `Team` role)?
- **Default assumed:** members with a configurable `trackedRoleId`; if unset,
  all non-bot members. Keeps presence polling scoped and cheap.

### Q4 — Day boundary / timezone (affects M1)
Single team timezone, or per-user? A single tz is far simpler and matches a
co-located team.
- **Default assumed:** one configured `timezone` (e.g. `America/New_York`); day
  = local calendar day there.

### Q5 — "Start of day" / "End of day" capture semantics (affects M3)
- Start: **first** post in `#goals-for-the-day` wins (later posts = goal edits,
  appended not overwritten)?
- End: **last** post in `#summary-of-the-day` wins?
- **Default assumed:** yes to both (`firstWins` / `lastWins` config flags).

### Q6 — Presence granularity (affects M4, storage size)
Aggregated counts (default) are enough for daily/weekly online-hours. Do you
ever need a **per-day timeline** (when exactly someone was online)?
- **Default assumed:** aggregated only. If timeline wanted later, add an
  append-only `presence_sample` table/items — additive, no migration of
  existing data.

### Q7 — Engagement weighting (affects M3)
Plain message count, or weight by reactions/thread replies/length?
- **Default assumed:** plain count of human messages in `#DevOffice`. Weighting
  is a later enhancement.

### Q8 — Auth provider for cli-kit (affects M0, AWS)
Local v1 uses `noopAuthProvider`. When hosted, do you want `@helmsmith/agent-auth`
(ecosystem standard) or something else?
- **Default assumed:** `noopAuthProvider` now; revisit at AWS time.

---

**Nothing here blocks starting.** The defaults let M0–M6 proceed; Q1/Q2 are the
two worth confirming early because they touch reporting visibility and CI
correctness.
