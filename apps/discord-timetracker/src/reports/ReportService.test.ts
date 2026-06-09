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
  v: { online?: number; voice?: number; ci?: number; msgs?: number },
) {
  const a = emptyDay(userId, date, `${date}T00:00:00Z`);
  a.presence = { samples: v.online ?? 0, online: v.online ?? 0 };
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

  it('daily: folds samples to minutes and sorts by online desc', async () => {
    await seedDay(storage, U1, '2026-06-10', { online: 6, voice: 2, ci: 3, msgs: 4 }); // 30m online
    await seedDay(storage, U2, '2026-06-10', { online: 12 }); // 60m online → first
    const s = await reports.daily('2026-06-10');
    expect(s.period).toBe('daily');
    expect(s.users[0].userId).toBe(U2); // most online first
    expect(s.users[0].onlineMinutes).toBe(60);
    const u1 = s.users.find((u) => u.userId === U1);
    expect(u1).toMatchObject({
      onlineMinutes: 30,
      voiceMinutes: 10,
      ciSubmissions: 3,
      engagementMessages: 4,
    });
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
