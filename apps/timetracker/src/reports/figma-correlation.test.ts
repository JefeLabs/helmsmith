/**
 * End-to-end read-model tests for the Figma correlation (PRD §5.4 / §11):
 * seeded events + presence + a Discord day-session → daily() rows carry the
 * correlation block, figmaDaily() feeds the panel, unmapped members surface.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FigmaEvent } from '../figma/types.js';
import { SqliteAdapter } from '../storage/sqlite/SqliteAdapter.js';
import { ReportService } from './ReportService.js';

const DAY = '2026-07-06';
const DISCORD_ANA = '123456789012345678';
const NOW = new Date(`${DAY}T18:00:00.000Z`);

const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;
const ev = (over: Partial<FigmaEvent>): FigmaEvent => ({
  eventType: 'version',
  fileKey: 'fileA',
  figmaUserId: 'u1',
  externalId: `x${Math.random()}`,
  at: at('14:00'),
  date: DAY,
  source: 'poll',
  ...over,
});

describe('figma correlation in reports', () => {
  let storage: SqliteAdapter;
  let reports: ReportService;

  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    reports = new ReportService(storage, 'monday', [], { gapMin: 30, padMin: 15 });

    await storage.setUserName(DISCORD_ANA, 'Ana');
    await storage.upsertFigmaMember('u1', 'ana');
    await storage.linkIdentity('figma', 'u1', DISCORD_ANA);
    await storage.upsertFigmaFile({ fileKey: 'fileA', name: 'design-system' });
  });

  it('attaches the correlation block to a mapped member with a day-session', async () => {
    await storage.setStartOfDay(DISCORD_ANA, DAY, {
      at: at('09:00'),
      messageId: 'm1',
      goals: 'polish tokens',
    });
    // One burst: 14:00 + 14:20 (gap 20m ≤ 30m); pad 15 → ~35m est.
    await storage.insertFigmaEvent(ev({ externalId: 'v1', at: at('14:00') }));
    await storage.insertFigmaEvent(ev({ externalId: 'c1', eventType: 'comment', at: at('14:20') }));
    // Measured presence: 13:58 → 15:00 = 62 min.
    await storage.openFigmaPresence('u1', 'fileA', DAY, at('13:58'));
    await storage.closeFigmaPresence('u1', 'fileA', at('15:00'));

    const s = await reports.daily(DAY, NOW);
    const ana = s.users.find((u) => u.userId === DISCORD_ANA);
    expect(ana?.figma).toEqual({
      eventCount: 2,
      byType: { version: 1, comment: 1 },
      estBurstMinutes: 35,
      bursts: 1,
      burstsInSession: 1, // open session (no summary) extends to now
      presenceMinutes: 62,
      topFiles: ['design-system'],
    });
  });

  it('adds no block for members without figma activity', async () => {
    await storage.setStartOfDay(DISCORD_ANA, DAY, { at: at('09:00'), messageId: 'm', goals: 'g' });
    const s = await reports.daily(DAY, NOW);
    expect(s.users.find((u) => u.userId === DISCORD_ANA)?.figma).toBeUndefined();
  });

  it('figmaDaily surfaces unmapped members instead of dropping them', async () => {
    await storage.upsertFigmaMember('u9', 'ghost');
    await storage.insertFigmaEvent(ev({ externalId: 'v2', figmaUserId: 'u9' }));
    const f = await reports.figmaDaily(DAY, NOW);
    expect(f.available).toBe(true);
    const ghost = f.members.find((m) => m.figmaUserId === 'u9');
    expect(ghost).toMatchObject({ handle: 'ghost', mapped: false, eventCount: 1 });
  });

  it('figmaDaily builds the event log, file heat, and presence-now', async () => {
    await storage.insertFigmaEvent(ev({ externalId: 'v1', at: at('14:00') }));
    await storage.insertFigmaEvent(ev({ externalId: 'v2', at: at('15:00') }));
    await storage.openFigmaPresence('u1', 'fileA', DAY, at('17:30')); // open 30m before NOW
    await storage.setMeta('figma:presence_heartbeat', at('17:59'));

    const f = await reports.figmaDaily(DAY, NOW);
    expect(f.events[0].at).toBe(at('15:00')); // newest first
    expect(f.fileHeat).toEqual([
      {
        fileKey: 'fileA',
        name: 'design-system',
        events: 2,
        lastTouchAt: at('15:00'),
        lastEditor: 'ana',
      },
    ]);
    expect(f.presenceNow).toEqual([
      { fileKey: 'fileA', fileName: 'design-system', users: [{ handle: 'ana', minutes: 30 }] },
    ]);
    expect(f.stale).toBe(false); // heartbeat 60s old < 180s window
  });

  it('flags stale presence when the heartbeat lapses', async () => {
    await storage.setMeta('figma:presence_heartbeat', at('17:00')); // 60 min old
    const f = await reports.figmaDaily(DAY, NOW);
    expect(f.stale).toBe(true);
  });

  it('events outside any session stay visible but unattributed', async () => {
    // No goals post today — bursts exist but none are in-session.
    await storage.insertFigmaEvent(ev({ externalId: 'v1', at: at('14:00') }));
    const s = await reports.daily(DAY, NOW);
    // No daily_activity row at all → user row doesn't exist; the figmaDaily
    // panel still shows the member's activity.
    expect(s.users).toHaveLength(0);
    const f = await reports.figmaDaily(DAY, NOW);
    expect(f.members[0]).toMatchObject({ handle: 'ana', eventCount: 1 });
  });
});
