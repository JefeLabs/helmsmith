/**
 * Sampling cadence — the single source of truth shared by the poller (which
 * takes samples) and the reports (which convert sample counts back to minutes).
 * Lives here, not in poller.ts, so reports/TUI never transitively import
 * discord.js.
 */
export const POLL_INTERVAL_MINUTES = 5;
export const POLL_INTERVAL_MS = POLL_INTERVAL_MINUTES * 60 * 1000;
