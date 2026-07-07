/**
 * timetracker-sentinel — private, team-internal plugin (PRD §4.5).
 *
 * Runs on the SENTINEL machine only: a host that keeps each monitored file
 * open in its own Figma desktop tab with this plugin running. Every
 * POLL_SECONDS it snapshots `figma.activeUsers` and POSTs it to the
 * timetracker's /presence endpoint, which derives measured in-file intervals.
 *
 * The tracker filters out the sentinel account's own user id server-side
 * (FIGMA_SENTINEL_USER_ID), so no filtering is needed here.
 *
 * EDIT THE THREE CONSTANTS BELOW before importing the plugin, and keep
 * ENDPOINT's origin listed in manifest.json networkAccess.allowedDomains.
 */

// ── configuration ───────────────────────────────────────────────────────
var ENDPOINT = 'http://localhost:3846/presence'; // tracker URL (tunnel/proxy or localhost)
var PASSCODE = ''; // must equal FIGMA_WEBHOOK_SECRET when one is configured
var POLL_SECONDS = 45; // keep in sync with FIGMA_PRESENCE_POLL_SEC
// ────────────────────────────────────────────────────────────────────────

figma.showUI(__html__, { width: 320, height: 180 });

var consecutiveErrors = 0;

function status(kind, message) {
  figma.ui.postMessage({ kind: kind, message: message, at: new Date().toISOString() });
}

async function snapshot() {
  // fileKey needs enablePrivatePluginApi (private plugins only).
  var fileKey = figma.fileKey;
  if (!fileKey) {
    status('error', 'figma.fileKey unavailable — is the plugin imported as a private plugin?');
    return;
  }
  var users = figma.activeUsers.map(function (u) {
    return { id: u.id, name: u.name };
  });
  var body = {
    passcode: PASSCODE || undefined,
    file_key: fileKey,
    file_name: figma.root.name,
    ts: new Date().toISOString(),
    users: users,
  };
  try {
    var res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      consecutiveErrors++;
      status('error', 'tracker replied ' + res.status + ' (x' + consecutiveErrors + ')');
      return;
    }
    consecutiveErrors = 0;
    status('ok', users.length + ' active user(s) posted');
  } catch (err) {
    consecutiveErrors++;
    status('error', 'POST failed: ' + (err && err.message ? err.message : err) + ' (x' + consecutiveErrors + ')');
  }
}

// First snapshot immediately, then on the poll cadence. The plugin (and this
// timer) lives for as long as the sentinel tab stays open — the tracker's
// heartbeat watchdog handles the tab dying (⚠ STALE + force-close).
snapshot();
setInterval(snapshot, POLL_SECONDS * 1000);
