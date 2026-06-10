import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDay } from '../domain/types.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { SqliteAdapter } from '../storage/sqlite/SqliteAdapter.js';
import { ReportService } from './ReportService.js';

// Poll interval is 5 min, so N samples → N×5 minutes.
const U1 = '100000000000000001';
const U2 = '100000000000000002';

async function seedDay(
  s: StorageAdapter,
  userId: string,
  date: string,
  v: {
    online?: number;
    idle?: number;
    voice?: number;
    ci?: number;
    msgs?: number;
    start?: string; // first-seen present (drives span)
    end?: string; // last-seen present (drives span)
  },
) {
  const a = emptyDay(userId, date, `${date}T00:00:00Z`);
  a.presence = {
    samples: (v.online ?? 0) + (v.idle ?? 0),
    online: v.online ?? 0,
    idle: v.idle ?? 0,
    firstOnlineAt: v.start,
    lastOnlineAt: v.end,
  };
  a.engagementVoiceSamples = v.voice ?? 0;
  a.ciSubmissions = v.ci ?? 0;
  a.engagementMessages = v.msgs ?? 0;
  await s.upsertDay(a);
}

describe('ReportService', () => {
  let storage: StorageAdapter;
  let reports: ReportService;
  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    reports = new ReportService(storage, 'monday');
  });

  it('daily: computes idle/span/active (span − idle) and sorts by active desc', async () => {
    // U1: present 09:00–12:00 (span 180m), 6 idle ticks (30m) → active 150m
    await seedDay(storage, U1, '2026-06-10', {
      online: 30,
      idle: 6,
      voice: 2,
      ci: 3,
      msgs: 4,
      start: '2026-06-10T09:00:00Z',
      end: '2026-06-10T12:00:00Z',
    });
    // U2: present 09:00–13:00 (span 240m), no idle → active 240m → first
    await seedDay(storage, U2, '2026-06-10', {
      online: 48,
      start: '2026-06-10T09:00:00Z',
      end: '2026-06-10T13:00:00Z',
    });
    const s = await reports.daily('2026-06-10', new Date('2026-06-10T18:00:00Z'));
    expect(s.period).toBe('daily');
    expect(s.users[0].userId).toBe(U2); // most active first
    expect(s.users[0].activeMinutes).toBe(240);
    const u1 = s.users.find((u) => u.userId === U1);
    expect(u1).toMatchObject({
      spanMinutes: 180,
      idleMinutes: 30,
      activeMinutes: 150, // 180 span − 30 idle
      voiceMinutes: 10,
      ciSubmissions: 3,
      engagementMessages: 4,
    });
  });

  it('daily: an open day (no end-of-day) spans start → now', async () => {
    await seedDay(storage, U1, '2026-06-10', { start: '2026-06-10T09:00:00Z' }); // no end yet
    const s = await reports.daily('2026-06-10', new Date('2026-06-10T11:00:00Z'));
    expect(s.users[0].spanMinutes).toBe(120); // 09:00 → now (11:00)
    expect(s.users[0].activeMinutes).toBe(120); // no idle observed
  });

  it('weekly: sums across the Mon–Sun window, counts active days, dense perDay', async () => {
    // 2026-06-10 is a Wednesday → week is 2026-06-08..06-14.
    await seedDay(storage, U1, '2026-06-08', { online: 6, ci: 1 }); // Mon, 30m
    await seedDay(storage, U1, '2026-06-10', { online: 12, ci: 2 }); // Wed, 60m
    const s = await reports.weekly('2026-06-10');
    expect(s.period).toBe('weekly');
    expect(s.from).toBe('2026-06-08');
    expect(s.to).toBe('2026-06-14');
    const u1 = s.users.find((u) => u.userId === U1);
    expect(u1?.onlineMinutes).toBe(90); // 30 + 60
    expect(u1?.ciSubmissions).toBe(3);
    expect(u1?.daysActive).toBe(2);
    expect(u1?.perDay).toHaveLength(7); // dense, 0-filled
    expect(u1?.perDay.find((d) => d.date === '2026-06-10')?.onlineMinutes).toBe(60);
    expect(u1?.perDay.find((d) => d.date === '2026-06-09')?.onlineMinutes).toBe(0);
  });

  it('daily: restricts to trackedUserIds when the allowlist is set', async () => {
    await seedDay(storage, U1, '2026-06-10', { online: 6, start: '2026-06-10T09:00:00Z' });
    await seedDay(storage, U2, '2026-06-10', { online: 6, start: '2026-06-10T09:00:00Z' });
    const scoped = new ReportService(storage, 'monday', [U1]);
    const s = await scoped.daily('2026-06-10', new Date('2026-06-10T18:00:00Z'));
    expect(s.users.map((u) => u.userId)).toEqual([U1]); // U2 excluded
  });

  it('daily: empty when no records', async () => {
    expect((await reports.daily('2026-01-01')).users).toEqual([]);
  });

  it('attaches display names when known, leaves undefined otherwise', async () => {
    await seedDay(storage, U1, '2026-06-10', { online: 6 });
    await seedDay(storage, U2, '2026-06-10', { online: 6 });
    await storage.setUserName(U1, 'Yelisson Ortiz');
    const s = await reports.daily('2026-06-10');
    expect(s.users.find((u) => u.userId === U1)?.displayName).toBe('Yelisson Ortiz');
    expect(s.users.find((u) => u.userId === U2)?.displayName).toBeUndefined();
  });
});
