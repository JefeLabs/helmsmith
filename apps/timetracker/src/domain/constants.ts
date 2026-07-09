/**
 * Sampling cadence — the single source of truth shared by the poller (which
 * takes samples) and the reports (which convert sample counts back to minutes).
 * Lives here, not in poller.ts, so reports/TUI never transitively import
 * discord.js.
 */
export const POLL_INTERVAL_MINUTES = 5;
export const POLL_INTERVAL_MS = POLL_INTERVAL_MINUTES * 60 * 1000;

/**
 * meta-table key holding the last instant the bot was alive (written by each
 * poller tick). `start`'s catch-up backfill reads the PREVIOUS run's value to
 * size its replay window. Shared by poller.ts and start.ts, so it lives here.
 */
export const LAST_SEEN_META_KEY = 'bot:last_seen_at';
