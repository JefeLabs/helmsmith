import { describe, expect, it } from 'vitest';
import { commentEvent, versionEvent, webhookEvent } from './normalize.js';

const TZ = 'America/New_York';

describe('versionEvent / commentEvent (poll path)', () => {
  it('normalizes a polled version with the version id as dedupe key', () => {
    const e = versionEvent(
      'fileA',
      { id: 'v42', created_at: '2026-07-06T14:00:00Z', user: { id: 'u1', handle: 'ana' } },
      TZ,
    );
    expect(e).toMatchObject({
      eventType: 'version',
      fileKey: 'fileA',
      figmaUserId: 'u1',
      externalId: 'v42',
      date: '2026-07-06', // 10:00 EDT
      source: 'poll',
    });
  });

  it('buckets the day-key in the configured timezone, not UTC', () => {
    // 03:00 UTC on the 7th is still the 6th in New York.
    const e = commentEvent(
      'fileA',
      { id: 'c1', created_at: '2026-07-07T03:00:00Z', user: { id: 'u1', handle: 'ana' } },
      TZ,
    );
    expect(e.date).toBe('2026-07-06');
  });
});

describe('webhookEvent', () => {
  it('normalizes FILE_VERSION_UPDATE with the same externalId as the poll path', () => {
    const n = webhookEvent(
      {
        event_type: 'FILE_VERSION_UPDATE',
        file_key: 'fileA',
        file_name: 'design-system',
        timestamp: '2026-07-06T14:00:00Z',
        triggered_by: { id: 'u1', handle: 'ana' },
        version_id: 'v42',
      },
      TZ,
    );
    expect(n.event).toMatchObject({
      eventType: 'version',
      externalId: 'v42', // ← same key the poll path produces → dedupes
      figmaUserId: 'u1',
      source: 'webhook',
    });
    expect(n.file).toEqual({ fileKey: 'fileA', name: 'design-system' });
    expect(n.member).toEqual({ figmaUserId: 'u1', handle: 'ana' });
  });

  it('keeps FILE_UPDATE with no user attribution (debounced, multi-user)', () => {
    const n = webhookEvent(
      {
        event_type: 'FILE_UPDATE',
        file_key: 'fileA',
        file_name: 'design-system',
        timestamp: '2026-07-06T14:00:00Z',
      },
      TZ,
    );
    expect(n.event).toMatchObject({
      eventType: 'file_update',
      figmaUserId: null,
      externalId: 'fileA:2026-07-06T14:00:00Z',
    });
    expect(n.member).toBeUndefined();
  });

  it('maps LIBRARY_PUBLISH and FILE_DELETE', () => {
    const base = { file_key: 'fileA', timestamp: '2026-07-06T14:00:00Z', triggered_by: { id: 'u2', handle: 'marco' } };
    expect(webhookEvent({ ...base, event_type: 'LIBRARY_PUBLISH' }, TZ).event?.eventType).toBe(
      'library_publish',
    );
    expect(webhookEvent({ ...base, event_type: 'FILE_DELETE' }, TZ).event?.eventType).toBe(
      'file_delete',
    );
  });

  it('acknowledges PING and unknown types without producing an event', () => {
    expect(webhookEvent({ event_type: 'PING', passcode: 'x' }, TZ).event).toBeNull();
    expect(webhookEvent({ event_type: 'SOMETHING_NEW', file_key: 'f' }, TZ).event).toBeNull();
    expect(webhookEvent({ event_type: 'FILE_UPDATE' }, TZ).event).toBeNull(); // no file_key
  });
});
