# timetracker-sentinel (private Figma plugin)

Real-time in-file presence for **monitored** files (PRD §4.5). A dedicated
"sentinel" machine keeps each monitored file open in its own Figma **desktop**
tab with this plugin running; the plugin polls `figma.activeUsers` and POSTs
snapshots to the tracker's `/presence` endpoint, which derives measured
presence intervals (open on appear; close after two consecutive misses).

## Setup

1. Edit `code.js`: set `ENDPOINT` (the tracker URL), `PASSCODE`
   (= `FIGMA_WEBHOOK_SECRET`, if configured), `POLL_SECONDS`
   (= `FIGMA_PRESENCE_POLL_SEC`).
2. Make sure `manifest.json → networkAccess.allowedDomains` lists the
   ENDPOINT's origin.
3. Figma desktop → Plugins → Development → **Import plugin from manifest…** →
   pick this `manifest.json`. Copy the generated plugin `id` back into the
   manifest.
4. In `.env`: set `FIGMA_PRESENCE_ENABLED=true` and `FIGMA_SENTINEL_USER_ID`
   to the sentinel account's Figma user id (the tracker filters it out of
   snapshots — the sentinel must not count itself). Get the id from
   `GET /v1/me` with the sentinel's token, or from the tracker log.
5. On the sentinel machine: open each monitored file in its own tab, run the
   plugin in each, and disable OS sleep / Figma tab discarding.

`figma.fileKey` and `figma.activeUsers` require a **private** plugin
(`enablePrivatePluginApi`, `permissions: ["activeusers"]`) — this plugin is
team-internal and must not be published publicly.

## Failure model

If the tab sleeps, the plugin closes, or the machine dies, snapshots stop:
the tracker's watchdog marks presence **⚠ STALE** after
`FIGMA_PRESENCE_STALE_SEC` and force-closes open intervals at the last
heartbeat — a dead sentinel never inflates presence time. Event ingestion
(webhooks/polling) is unaffected; the dashboard degrades to events-only.
