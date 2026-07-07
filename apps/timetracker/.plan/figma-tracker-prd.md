# PRD: Figma Activity Tracker — Extension to Team Presence System

**Status:** Draft v1.0 — **implemented 2026-07-06** (see mapping below)
**Owner:** Edwin
**Date:** 2026-07-06
**Type:** Complement to existing Discord presence tracker (not standalone)

> **Implementation note.** §4.1's component names predate the TypeScript
> rebuild; the shipped mapping is: `figma-tracker.js` → `src/figma/tracker.ts`
> (run via `timetracker figma start`) · `lib/figma-api.js` → `src/figma/api.ts`
> · `lib/figma-sessions.js` → `src/figma/bursts.ts` + `src/figma/presence.ts`
> · `lib/db.js`/`schema.sql` → `FigmaStorage` port implemented in
> `SqliteAdapter` (WAL enabled) · `dashboard.js`/`lib/widgets.js` → `f` panel
> in `src/tui/SummaryView.tsx` · `state.json` → storage `meta` keys
> (`figma:*`). Deliberate deltas: no `figma_bursts` table (bursts derive at
> read time), member mapping reuses `identity_map(provider='figma')`, and
> event dedupe uses natural external ids (version/comment id) instead of
> §4.3's `(type, file, user, ts)` tuple — strictly stronger across
> webhook+poll. Phases 0–5 all landed; both 1A and 1B ship behind
> `FIGMA_WEBHOOK_ENABLED`.

---

## 1. Overview

### 1.1 Problem
The existing Discord bot answers *"who is present, and for how long"* (presence status, voice channel usage in DevOffice / TriageRoom / ProjectOffice / DesignStudio, and goals→summary work sessions). It cannot answer *"what was actually produced during that time."* For design work specifically, presence in DesignStudio voice does not confirm design activity.

### 1.2 Solution
A Figma event tracker that ingests team activity (file edits, versions, comments, library publishes) into the **same SQLite database** as the Discord tracker, rendered in the **same blessed TUI dashboard** as an additional panel, with cross-source correlation between Discord sessions and Figma output.

### 1.3 Why a complement, not a standalone tool
- **Shared session model.** The goals/summary day-session is the anchor unit of the whole system. Figma events should be attributed to those sessions, not tracked in a parallel timeline.
- **Correlation is the value.** "3h in DesignStudio voice + 47 Figma edit events" tells a story neither source tells alone.
- **Infrastructure reuse.** `lib/db.js`, `schema.sql`, `dashboard.js`, `lib/widgets.js`, and `state.json` all extend naturally; a standalone tool duplicates all of them.

---

## 2. Constraints & Platform Reality

These shape everything below — they are not implementation details.

| Capability | Available? | Notes |
|---|---|---|
| Real-time presence via REST/webhooks | ❌ | Not exposed by any official server-side API |
| Real-time presence via Plugin API (`figma.activeUsers`) | ✅ With caveat | Only while a client has the file open with the plugin running → **sentinel pattern**, see §4.5 |
| Webhooks (FILE_UPDATE, FILE_VERSION_UPDATE, FILE_COMMENT, LIBRARY_PUBLISH, FILE_DELETE) | ✅ Professional plan+ | Team-scoped, requires public HTTPS endpoint |
| Version history polling | ✅ Any paid plan w/ token | `GET /v1/files/:key/versions` — who saved, when |
| Comments polling | ✅ | `GET /v1/files/:key/comments` |
| Activity Logs API (true per-user firehose) | ❌ Enterprise only | Out of scope |
| Scraping Figma's multiplayer websocket | ❌ | Undocumented, ToS violation — never used |

**Key consequence:** Figma activity is *event-based and coarse*, unlike Discord's continuous presence. `FILE_UPDATE` webhooks debounce (~30–60 min of active editing, or when editing stops). Sessions must therefore be **inferred** from event clustering, never measured directly.

**Decision gate (open question #1):** Confirm team plan. Professional+ → webhook-first architecture (Phase 1A). Starter/other → polling-only (Phase 1B). Both paths converge at the same DB schema.

---

## 3. Goals & Non-Goals

### Goals
1. Ingest Figma team activity events into the shared SQLite DB with per-member attribution.
2. Attribute Figma events to active Discord day-sessions (goals→summary window).
3. Infer Figma "work bursts" via event clustering (configurable gap threshold, default 30 min).
4. Add a Figma panel to the existing TUI dashboard (recent events, per-member daily activity, per-file heat).
5. Daily correlation summary: Discord session time vs. Figma event counts per member.
6. **Real-time in-file presence** for sentinel-monitored files via a private plugin polling `figma.activeUsers`, stored as intervals matching the Discord presence model.

### Non-Goals
- Team-wide real-time presence (sentinel presence is per-monitored-file only; unmonitored files show event data only).
- Keystroke/edit-level granularity (Enterprise-only territory).
- Tracking non-team members or files outside the configured team/projects.
- A second dashboard or second database.
- Any member-invisible behavior claims beyond what Figma permits — webhooks and tokens are visible to team admins in Figma settings. (See §8.)

---

## 4. Architecture

### 4.1 New components

```
figma-tracker.js        # Standalone service (like bot.js): webhook receiver + poller
lib/figma-api.js        # REST client: versions, comments, file metadata, webhook mgmt
lib/figma-sessions.js   # Event-clustering logic (burst inference)
lib/db.js               # EXTENDED: figma tables + correlation queries
lib/widgets.js          # EXTENDED: figma panel widgets
schema.sql              # EXTENDED: see 4.3
state.json              # EXTENDED: figma tracker heartbeat + last-event cache
dashboard.js            # EXTENDED: reads figma state, renders new panel
.env                    # + FIGMA_TOKEN, FIGMA_TEAM_ID, WEBHOOK_SECRET, WEBHOOK_PORT
figma-plugin/           # Sentinel presence plugin (private, team-internal)
  manifest.json         #   allowedDomains: [tracker endpoint]
  code.js               #   setInterval poll of figma.activeUsers → POST snapshot
  ui.html               #   minimal status view (last POST, error state)
```

`figma-tracker.js` runs as a **separate process** from `bot.js` (mirrors the existing bot/dashboard split): a Discord outage never blocks Figma ingestion and vice versa. Both write to the same SQLite file via better-sqlite3 (WAL mode required — see §7 risks).

### 4.2 Data flow

**Webhook path (Professional+):**
```
Figma team event → HTTPS webhook → figma-tracker.js
  → verify passcode → normalize → INSERT figma_events
  → update state.json (last_event, counts)
Dashboard reads DB + state.json (existing pattern, no new IPC)
```

**Polling path (fallback / gap-fill):**
```
Every POLL_INTERVAL (default 10 min):
  for each tracked file key:
    GET /versions, GET /comments (paginated, since last cursor)
    → dedupe against figma_events → INSERT new
```
Polling runs even in webhook mode at a slower cadence (60 min) to backfill anything missed during downtime.

**Sentinel presence path (real-time, per-monitored-file):**
```
Sentinel machine keeps monitored file(s) open in Figma desktop
  → private plugin polls figma.activeUsers every PRESENCE_POLL_SEC (default 45s)
  → POST snapshot {file_key, users[], ts} to figma-tracker.js /presence
  → tracker diffs against open intervals: user appeared → open interval;
    user absent for 2 consecutive polls → close interval
  → sentinel heartbeat written to state.json; dashboard flags stale (>3 min) presence data
```

### 4.3 Schema additions

```sql
CREATE TABLE figma_members (
  figma_user_id TEXT PRIMARY KEY,
  handle        TEXT NOT NULL,
  discord_id    TEXT REFERENCES members(discord_id)  -- manual mapping, see §6
);

CREATE TABLE figma_files (
  file_key   TEXT PRIMARY KEY,
  name       TEXT,
  project    TEXT,
  tracked    INTEGER DEFAULT 1
);

CREATE TABLE figma_events (
  id            INTEGER PRIMARY KEY,
  event_type    TEXT NOT NULL,      -- file_update | version | comment | library_publish | file_delete
  file_key      TEXT REFERENCES figma_files(file_key),
  figma_user_id TEXT REFERENCES figma_members(figma_user_id),
  ts            INTEGER NOT NULL,   -- unix epoch
  payload       TEXT,               -- raw JSON for audit/replay
  source        TEXT NOT NULL,      -- 'webhook' | 'poll'
  UNIQUE(event_type, file_key, figma_user_id, ts)  -- dedupe key
);

CREATE TABLE figma_bursts (         -- inferred, recomputed by figma-sessions.js
  id            INTEGER PRIMARY KEY,
  figma_user_id TEXT,
  start_ts      INTEGER,
  end_ts        INTEGER,
  event_count   INTEGER,
  session_id    INTEGER REFERENCES sessions(id)  -- link to Discord day-session, nullable
);

CREATE TABLE figma_presence (       -- measured, from sentinel plugin; same interval shape as Discord presence
  id            INTEGER PRIMARY KEY,
  figma_user_id TEXT REFERENCES figma_members(figma_user_id),
  file_key      TEXT REFERENCES figma_files(file_key),
  start_ts      INTEGER NOT NULL,
  end_ts        INTEGER,            -- NULL = interval currently open
  session_id    INTEGER REFERENCES sessions(id)
);
```

### 4.4 Session attribution logic

On insert of a Figma event:
1. Resolve `figma_user_id → discord_id` via `figma_members` mapping.
2. If that member has an **open day-session** (goals posted, no summary yet) covering `ts`, tag downstream burst with `session_id`.
3. Burst inference: events by the same user separated by ≤ `BURST_GAP_MIN` (default 30) merge into one burst; burst duration = `last_event − first_event + BURST_PAD_MIN` (default 15, compensating for debounce lag). Bursts are labeled as **estimates** everywhere in the UI.

### 4.5 Sentinel presence (real-time, accepted requirement)
Edwin's decision: keeping Figma open on a dedicated machine is acceptable, so real-time presence is in scope.

- **Mechanism:** A machine (Edwin's desktop or the bot host with Figma desktop installed) keeps each monitored file open in its own tab, running a private plugin per tab. The plugin polls `figma.activeUsers` every `PRESENCE_POLL_SEC` (45s default) and POSTs `{file_key, users[], ts}` to `POST /presence` on figma-tracker.js (endpoint whitelisted in the plugin manifest's `allowedDomains`).
- **Interval derivation:** The tracker maintains open intervals per (user, file). A user in the snapshot but with no open interval → open one at `ts`. A user missing from **two consecutive** snapshots → close their interval at the last-seen `ts` (single-miss tolerance absorbs poll jitter). All intervals get session attribution via the same logic as §4.4.
- **Staleness handling:** Every accepted snapshot updates a sentinel heartbeat in `state.json`. If the heartbeat exceeds 3 min, the dashboard marks presence data ⚠ STALE and open intervals are force-closed at the last heartbeat — a dead sentinel must never silently inflate presence time.
- **Scope discipline:** Presence exists only for monitored files (initially the DesignStudio-linked design-system file; expandable, one tab per file). All other files show event data only — the dashboard must never blend the two into a single "Figma time" number without labeling.
- **Note on self-counting:** The sentinel account itself appears in `activeUsers`; the tracker filters out the sentinel's own user ID via `SENTINEL_USER_ID` in `.env`.

---

## 5. Dashboard Additions

New TUI panel set (blessed-contrib), togglable with existing panel-cycling keys:

1. **Figma Live Log** — scrolling recent events: `[14:32] ana — version saved — design-system.fig`.
2. **Daily Activity per Member** — bar: event counts today, split by type.
3. **File Heat** — table: file name, events today, last touch, last editor.
4. **Correlation Row** (on the existing member summary panel) — per member per day-session: `voice: 3h12m (DesignStudio 2h40m) | figma: 47 events, ~2h05m est. burst time | in-file: 1h58m (design-system)`.
5. **Figma Presence Now** — live list for monitored files: `design-system.fig: ● ana (12m), ● marco (3m)` with the ⚠ STALE flag when the sentinel heartbeat lapses.

Estimated times always carry the `~` marker and "est." suffix; sentinel presence times are measured and shown without the marker — the two must remain visually distinct.

---

## 6. Setup & Configuration

1. **Figma personal access token** (or OAuth later) with `file_read`, `webhooks:write` scopes → `.env`.
2. **Webhook endpoint**: figma-tracker.js exposes `POST /figma-webhook` on `WEBHOOK_PORT`; needs public HTTPS (options: existing VPS reverse proxy, Cloudflare Tunnel, or ngrok for dev). Passcode verification on every delivery.
3. **Register webhooks** on startup (idempotent): one per event type, team-scoped.
4. **Member mapping**: one-time manual CLI step — `node figma-tracker.js map-members` lists team members from a seed file fetch and prompts for Discord ID pairing. 5 members, so manual is fine; no auto-matching heuristics.
5. **File discovery**: seed `figma_files` from team projects endpoint; new files auto-added on first webhook event.

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Webhook debounce makes bursts look shorter/later than reality | Misleading time estimates | Pad bursts (`BURST_PAD_MIN`), label all durations as estimates, backfill via version polling |
| SQLite write contention (two writer processes) | Locked-DB errors | WAL mode + `busy_timeout`; both services already use short transactions |
| Webhook endpoint downtime → lost events | Gaps in data | Hourly polling backfill with dedupe key |
| Plan turns out to be Starter | No webhooks at all | Phase 1B polling-only path; same schema, POLL_INTERVAL=10min |
| API rate limits during polling | Throttling | Per-file cursors, exponential backoff, cap tracked files |
| Figma user with no Discord mapping | Orphan events | Store anyway with NULL discord_id; surface "unmapped" in dashboard |
| Sentinel tab sleeps / machine reboots / plugin closed | Silent presence gaps or inflated open intervals | Heartbeat in state.json; force-close intervals on staleness; ⚠ STALE dashboard flag; disable OS sleep + Figma tab discarding on sentinel machine |
| Figma changes Plugin API behavior (`activeUsers`) | Presence pipeline breaks | Presence is additive — event pipeline unaffected; plugin failure degrades gracefully to events-only |
| Presence ≠ activity (parked-in-file users) | Overstated "working" time | Same ambiguity as Discord idle; present in-file time as presence, not productivity; correlate with bursts |

---

## 8. Privacy & Transparency Note

Unlike the Discord bot's minimized-visibility configuration, Figma-side tracking is inherently visible to team admins (registered webhooks and token usage appear in team settings), and this system records member work patterns. Since this is a 5-person team Edwin owns, the recommendation is to tell the team what's tracked and why — it's tied to the shared goals ritual, and the correlation data is more useful when members trust and can see it. Consider a `!mystats` Discord command as a later phase so members can view their own data.

---

## 9. Milestones

| Phase | Scope | Est. effort |
|---|---|---|
| **0** | Confirm Figma plan; token + team ID; schema migration; member mapping CLI | 0.5 day |
| **1A** | Webhook receiver, event normalization, dedupe, state.json integration *(if Professional+)* | 1 day |
| **1B** | Polling engine with cursors *(if Starter — replaces 1A)* | 1 day |
| **2** | Burst inference + day-session attribution | 0.5 day |
| **3** | Dashboard panels + correlation row | 1 day |
| **4** | Hourly backfill poller, retry/backoff hardening, unmapped-member surfacing | 0.5 day |
| **5** | Sentinel presence: private plugin, `/presence` endpoint, interval derivation, heartbeat/staleness, Presence Now panel | 1 day |

---

## 10. Open Questions

1. **What Figma plan is the team on?** Gates Phase 1A vs 1B.
2. Where will the webhook endpoint live — existing host for the Discord bot, or a tunnel?
3. Should `BURST_GAP_MIN` align with any existing idle threshold in the Discord tracker for consistency?
4. Track all team projects, or only design files linked to DesignStudio work?
5. **Sentinel host:** Edwin's desktop (free, but presence data dies when it sleeps/shuts down) or the bot's always-on host (needs Figma desktop + a display/virtual display)?
6. Which files get sentinel monitoring at launch — design-system only, or one per active project?
7. Sentinel account: Edwin's own Figma account, or a dedicated seat? (A dedicated seat costs money but keeps Edwin's real presence out of the data and survives his personal usage patterns.)

---

## 11. Success Criteria

- Every version/comment/publish event on tracked files appears in the DB within 2 min (webhook mode) or one poll interval (polling mode).
- ≥95% of events attributed to the correct member; zero duplicate events across webhook+poll ingestion.
- Correlation row renders for any member with both an open day-session and ≥1 Figma event.
- Sentinel presence intervals within ±90s of actual join/leave times (bounded by poll interval); zero open intervals surviving a stale sentinel.
- Discord tracker behavior is completely unaffected (no schema breakage, no new latency in bot.js).
