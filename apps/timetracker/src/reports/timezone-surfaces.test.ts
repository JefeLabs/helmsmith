/**
 * The cached Intl time formatter (render.ts) is shared by every surface that shows
 * times. This guards that each surface — CLI text, TUI table, Discord message —
 * renders the *configured* timezone, and that interleaving two timezones across the
 * surfaces never bleeds (the per-tz Map must key correctly regardless of call order).
 */
import { describe, expect, it } from 'vitest';
import { dailyColumns } from '../tui/model.js';
import type { ReportService } from './ReportService.js';
import { dailyMessage } from './discord.js';
import { renderDaily } from './render.js';
import type { DailySummary } from './types.js';

// One user, fixed instants: 13:30Z start / 21:00Z end.
// → UTC 13:30 / 21:00   ·   America/New_York (EDT, UTC−4 in June) 09:30 / 17:00
const summary = (): DailySummary => ({
  period: 'daily',
  date: '2026-06-10',
  users: [
    {
      userId: 'u',
      displayName: 'Edwin',
      onlineMinutes: 0,
      voiceMinutes: 0,
      idleMinutes: 0,
      spanMinutes: 0,
      activeMinutes: 0,
      startedAt: '2026-06-10T13:30:00Z',
      endedAt: '2026-06-10T21:00:00Z',
      ciSubmissions: 0,
      engagementMessages: 0,
    },
  ],
});

/** TUI surface: render the daily 'start' column cell in a timezone. */
const tuiStart = (tz: string): string | undefined => {
  const col = dailyColumns(tz).find((c) => c.key === 'start');
  return col?.render?.(summary().users[0], 0);
};

/** Discord surface: a ReportService whose daily() yields the fixture. */
const fakeReports = { daily: async () => summary() } as unknown as ReportService;

describe('daily time rendering across surfaces (shared cached formatter)', () => {
  it('renders the configured timezone on every surface, interleaved without contamination', async () => {
    // Interleave UTC and America/New_York across CLI / TUI / Discord. If the shared
    // per-tz cache leaked, a later call in another tz would return a stale time.
    expect(renderDaily(summary(), 'UTC')).toContain('13:30'); // CLI · UTC
    expect(tuiStart('America/New_York')).toBe('09:30'); // TUI · EDT
    expect(await dailyMessage(fakeReports, '2026-06-10', 'UTC')).toContain('13:30'); // Discord · UTC
    expect(tuiStart('UTC')).toBe('13:30'); // TUI · UTC (after an EDT call)
    expect(renderDaily(summary(), 'America/New_York')).toContain('09:30'); // CLI · EDT
    expect(await dailyMessage(fakeReports, '2026-06-10', 'America/New_York')).toContain('09:30'); // Discord · EDT
  });

  it('renders end times per timezone too (CLI surface)', () => {
    expect(renderDaily(summary(), 'UTC')).toContain('21:00');
    expect(renderDaily(summary(), 'America/New_York')).toContain('17:00');
  });
});
