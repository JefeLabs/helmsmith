import { describe, expect, it } from 'vitest';
import {
  dailyColumns,
  figmaCorrelationLine,
  figmaEventLine,
  figmaMemberLine,
  figmaPresenceLine,
  pageDate,
  sparkline,
  weeklyColumns,
} from './model.js';

describe('pageDate', () => {
  it('pages ±1 day in daily mode', () => {
    expect(pageDate('2026-06-10', 1, 'daily')).toBe('2026-06-11');
    expect(pageDate('2026-06-10', -1, 'daily')).toBe('2026-06-09');
  });
  it('pages ±7 days in weekly mode', () => {
    expect(pageDate('2026-06-10', 1, 'weekly')).toBe('2026-06-17');
    expect(pageDate('2026-06-10', -1, 'weekly')).toBe('2026-06-03');
  });
});

describe('sparkline', () => {
  it('maps a series into block glyphs, scaled to the max', () => {
    const s = sparkline([0, 30, 60, 120]);
    expect(s).toHaveLength(4);
    expect(s[0]).toBe(' '); // zero → blank
    expect(s[3]).toBe('█'); // max → full block
  });
  it('handles an all-zero series without dividing by zero', () => {
    expect(sparkline([0, 0, 0])).toBe('   ');
  });
  it('returns empty for an empty series', () => {
    expect(sparkline([])).toBe('');
  });
});

describe('column definitions', () => {
  it('daily has the expected columns and renders durations/times', () => {
    const cols = dailyColumns('UTC');
    expect(cols.map((c) => c.key)).toEqual([
      'userId',
      'online',
      'voice',
      'ci',
      'msgs',
      'start',
      'end',
    ]);
    const online = cols.find((c) => c.key === 'online');
    expect(
      online?.render?.(
        {
          userId: 'u',
          onlineMinutes: 90,
          voiceMinutes: 0,
          idleMinutes: 0,
          spanMinutes: 0,
          activeMinutes: 0,
          ciSubmissions: 0,
          engagementMessages: 0,
        },
        0,
      ),
    ).toBe('1h 30m');
  });
  it('weekly is a Mon–Fri grid + WK Active + Avg/day', () => {
    const cols = weeklyColumns().map((c) => c.key);
    expect(cols).toEqual(['userId', 'wd0', 'wd1', 'wd2', 'wd3', 'wd4', 'wk', 'avg']);
  });
});

describe('figma panel lines', () => {
  it('renders the live-log line in the PRD shape', () => {
    const line = figmaEventLine(
      { at: '2026-07-06T18:32:00Z', eventType: 'version', handle: 'ana', fileName: 'design-system' },
      'UTC',
    );
    expect(line).toBe('[18:32] ana — version saved — design-system');
  });

  it('marks burst estimates with ~/est. but never in-file time', () => {
    const line = figmaMemberLine({
      figmaUserId: 'u1',
      handle: 'ana',
      discordName: 'Ana',
      mapped: true,
      eventCount: 47,
      byType: { version: 40, comment: 7 },
      estBurstMinutes: 125,
      presenceMinutes: 118,
    });
    expect(line).toContain('~2h 5m est.');
    expect(line).toContain('in-file 1h 58m');
    expect(line).not.toContain('in-file ~'); // measured time carries no marker
  });

  it('flags unmapped members', () => {
    const line = figmaMemberLine({
      figmaUserId: 'u9',
      handle: 'ghost',
      mapped: false,
      eventCount: 3,
      byType: {},
      estBurstMinutes: 15,
      presenceMinutes: 0,
    });
    expect(line).toContain('⚠ unmapped');
  });

  it('renders presence-now with live dots', () => {
    const line = figmaPresenceLine({
      fileKey: 'f',
      fileName: 'design-system',
      users: [
        { handle: 'ana', minutes: 12 },
        { handle: 'marco', minutes: 3 },
      ],
    });
    expect(line).toBe('design-system: ● ana (12m), ● marco (3m)');
  });

  it('builds the correlation row with session attribution counts', () => {
    const line = figmaCorrelationLine({
      eventCount: 47,
      byType: {},
      estBurstMinutes: 125,
      burstsInSession: 2,
      bursts: 3,
      presenceMinutes: 118,
      topFiles: ['design-system'],
    });
    expect(line).toBe(
      '47 events  ·  ~2h 5m est. (2/3 bursts in session)  ·  in-file 1h 58m  ·  design-system',
    );
  });
});
