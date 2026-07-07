import { describe, expect, it } from 'vitest';
import type { FigmaDailySummary } from './types.js';
import { formatDuration, formatTime, renderFigmaDaily } from './render.js';

describe('formatDuration', () => {
  it('formats hours/minutes; em-dash for zero', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(150)).toBe('2h 30m');
  });
});

describe('renderFigmaDaily', () => {
  const base: FigmaDailySummary = {
    date: '2026-07-07',
    available: true,
    presenceNow: [{ fileKey: 'F', fileName: 'design-system', users: [{ handle: 'ana', minutes: 12 }] }],
    members: [
      { figmaUserId: 'u1', handle: 'ana', discordName: 'Ana', mapped: true, eventCount: 5, byType: {}, estBurstMinutes: 75, presenceMinutes: 118 },
      { figmaUserId: 'u9', handle: 'ghost', mapped: false, eventCount: 2, byType: {}, estBurstMinutes: 30, presenceMinutes: 0 },
    ],
    fileHeat: [{ fileKey: 'F', name: 'design-system', events: 7, lastTouchAt: '2026-07-07T18:32:00Z', lastEditor: 'ana' }],
    events: [{ at: '2026-07-07T18:32:00Z', eventType: 'version', handle: 'ana', fileName: 'design-system' }],
    heartbeatAt: '2026-07-07T18:31:00Z',
    stale: false,
  };

  it('renders presence, member activity, file heat, and events', () => {
    const out = renderFigmaDaily(base, 'UTC');
    expect(out).toContain('● design-system: ana (12m)');
    expect(out).toContain('~1h 15m'); // burst estimate marked with ~
    expect(out).toContain('1h 58m'); // measured in-file time (118 min), no marker
    expect(out).toContain('[18:32] ana — version saved — design-system');
  });

  it('marks unmapped members; estimate carries ~, measured time does not', () => {
    const out = renderFigmaDaily(base, 'UTC');
    expect(out).toContain('ghost ⚠'); // unmapped flag
    expect(out).toContain('run `figma map-members`');
    expect(out).toContain('~30m'); // ghost's est burst
    expect(out).not.toContain('~1h 58m'); // measured in-file never gets the ~ marker
  });

  it('flags a stale sentinel heartbeat', () => {
    expect(renderFigmaDaily({ ...base, stale: true }, 'UTC')).toContain('⚠ STALE');
  });

  it('handles an empty day and an unavailable backend', () => {
    const empty = { ...base, presenceNow: [], members: [], fileHeat: [], events: [] };
    expect(renderFigmaDaily(empty, 'UTC')).toContain('no figma activity recorded');
    expect(renderFigmaDaily({ ...base, available: false }, 'UTC')).toContain('not available');
  });
});

describe('formatTime (per-timezone cached formatter)', () => {
  const iso = '2026-06-10T13:30:00Z';

  it('renders the timestamp in the given timezone', () => {
    expect(formatTime(iso, 'UTC')).toBe('13:30');
    expect(formatTime(iso, 'America/New_York')).toBe('09:30'); // EDT (UTC−4) in June
  });

  it('keeps timezones independent when interleaved (cache keys by tz)', () => {
    // The same instant through different tz, interleaved — the cache must not bleed.
    expect(formatTime(iso, 'UTC')).toBe('13:30');
    expect(formatTime(iso, 'America/New_York')).toBe('09:30');
    expect(formatTime(iso, 'UTC')).toBe('13:30');
  });

  it('returns — for a missing timestamp', () => {
    expect(formatTime(undefined, 'UTC')).toBe('—');
  });
});
