import { describe, expect, it } from 'vitest';
import { formatDuration, formatTime } from './render.js';

describe('formatDuration', () => {
  it('formats hours/minutes; em-dash for zero', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(150)).toBe('2h 30m');
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
