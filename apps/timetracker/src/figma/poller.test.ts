import { beforeEach, describe, expect, it } from 'vitest';
import { FigmaSchema } from '../config/schema.js';
import { SqliteAdapter } from '../storage/sqlite/SqliteAdapter.js';
import type { FigmaComment, FigmaVersion } from './api.js';
import { FIGMA_META, type FigmaDeps } from './context.js';
import { type FigmaPollApi, runFigmaPollOnce } from './poller.js';

const TZ = 'America/New_York';
const ana = { id: 'u1', handle: 'ana' };

function fakeApi(data: {
  versions?: Record<string, FigmaVersion[]>;
  comments?: Record<string, FigmaComment[]>;
  failFor?: string[];
}): FigmaPollApi {
  return {
    async getFileVersions(key) {
      if (data.failFor?.includes(key)) throw new Error('429');
      return data.versions?.[key] ?? [];
    },
    async getFileComments(key) {
      if (data.failFor?.includes(key)) throw new Error('429');
      return data.comments?.[key] ?? [];
    },
  };
}

describe('runFigmaPollOnce', () => {
  let storage: SqliteAdapter;
  let deps: FigmaDeps;
  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    deps = {
      storage,
      timezone: TZ,
      figma: FigmaSchema.parse({ token: 't', teamId: '99' }),
    };
    await storage.upsertFigmaFile({ fileKey: 'fileA', name: 'design-system' });
    await storage.upsertFigmaFile({ fileKey: 'fileB', name: 'website' });
  });

  it('ingests versions and comments across tracked files, upserting members', async () => {
    const api = fakeApi({
      versions: {
        fileA: [{ id: 'v1', created_at: '2026-07-06T14:00:00Z', user: ana }],
      },
      comments: {
        fileB: [{ id: 'c1', created_at: '2026-07-06T15:00:00Z', user: { id: 'u2', handle: 'marco' } }],
      },
    });
    const r = await runFigmaPollOnce(api, deps);
    expect(r).toEqual({ files: 2, inserted: 2 });
    expect(await storage.listFigmaMembers()).toHaveLength(2);
    expect(await storage.getMeta(FIGMA_META.lastEventAt)).toBe('2026-07-06T15:00:00Z');
    expect(await storage.getMeta(FIGMA_META.lastPollAt)).toBeTruthy();
  });

  it('a second sweep over the same data inserts nothing (dedupe)', async () => {
    const api = fakeApi({
      versions: { fileA: [{ id: 'v1', created_at: '2026-07-06T14:00:00Z', user: ana }] },
    });
    await runFigmaPollOnce(api, deps);
    const r = await runFigmaPollOnce(api, deps);
    expect(r.inserted).toBe(0);
  });

  it('skips untracked files', async () => {
    await storage.setFigmaFileTracked('fileB', false);
    const api = fakeApi({
      versions: { fileB: [{ id: 'v9', created_at: '2026-07-06T14:00:00Z', user: ana }] },
    });
    const r = await runFigmaPollOnce(api, deps);
    expect(r).toEqual({ files: 1, inserted: 0 });
  });

  it('one failing file does not block the others', async () => {
    const api = fakeApi({
      failFor: ['fileA'],
      versions: { fileB: [{ id: 'v2', created_at: '2026-07-06T14:00:00Z', user: ana }] },
    });
    const r = await runFigmaPollOnce(api, deps);
    expect(r.inserted).toBe(1);
  });
});
