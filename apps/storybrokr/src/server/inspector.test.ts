import { describe, expect, it, vi } from 'vitest';
import type { SettleOutcome } from '../lib/settle.js';
import type { InstanceRecord } from '../types.js';
import { createInspector, type InspectorContext } from './inspector.js';

const record: InstanceRecord = {
  id: 'inst1',
  hostRoot: '/h',
  component: 'src/Panel',
  framework: 'react-vite',
  port: 6100,
  url: 'http://127.0.0.1:6100',
  pid: 1,
  status: 'ready',
  createdAt: 'c',
  lastTouchedAt: 't',
  ttlMinutes: 30,
  storyFiles: [],
  stories: ['a', 'b'].map((id) => ({
    id: `panel--${id}`,
    title: 'Panel',
    name: id,
    importPath: './x',
    url: `http://127.0.0.1:6100/?path=/story/panel--${id}`,
    iframeUrl: `http://127.0.0.1:6100/iframe.html?id=panel--${id}&viewMode=story`,
  })),
  configDir: '/h/node_modules/.cache/storybrokr/inst1',
};

// PNG header: 8-byte signature, then IHDR chunk with width at byte 16 and height at byte 20.
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b.write('\x89PNG\r\n\x1a\n', 0, 'binary');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function harness(
  outcomes: Record<string, SettleOutcome>,
  box: { x: number; y: number; width: number; height: number } | null = {
    x: 1,
    y: 2,
    width: 300,
    height: 200,
  },
) {
  const shots: unknown[] = [];
  const page = {
    goto: async () => {},
    evaluate: async () => [],
    waitForLoadState: async () => {},
    waitForSelector: async () => ({}),
    getByText: () => ({ waitFor: async () => {} }),
    locator: () => ({
      boundingBox: async () => box,
      screenshot: async () => {
        shots.push('element');
        return png(300, 200);
      },
    }),
    screenshot: async (o: unknown) => {
      shots.push(o);
      return png(300, 200);
    },
  };
  const ctx: InspectorContext = {
    addInitScript: vi.fn(async () => {}),
    newPage: async () => page,
    close: vi.fn(async () => {}),
  };
  const acquire = vi.fn(async () => ctx);
  const settle = vi.fn(async (_p: unknown, o: { iframeUrl: string }) => {
    const id = new URL(o.iframeUrl).searchParams.get('id') ?? '';
    return outcomes[id] ?? { kind: 'pass', played: false };
  });
  const writes: { path: string; data: Buffer }[] = [];
  const writeFile = vi.fn(async (path: string, data: Buffer) => {
    writes.push({ path, data });
  });
  const inspector = createInspector({ pool: { acquire }, settle: settle as never, writeFile });
  return { inspector, acquire, ctx, settle, shots, writes };
}

describe('inspector.check', () => {
  it('runs every story in order on one context, installs the recorder, and closes the context', async () => {
    const h = harness({ 'panel--b': { kind: 'pass', played: true } });
    const res = await h.inspector.check(record, {});
    expect(h.acquire).toHaveBeenCalledTimes(1);
    expect(h.ctx.addInitScript).toHaveBeenCalledTimes(1);
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
    expect(res.instanceId).toBe('inst1');
    expect(res.results.map((r) => [r.storyId, r.status, r.played])).toEqual([
      ['panel--a', 'pass', false],
      ['panel--b', 'pass', true],
    ]);
    expect(res.summary).toEqual({ pass: 2, fail: 0, timeout: 0 });
  });

  it('reports fail and timeout as rows, with the error detail, and passes waitFor/timeout through', async () => {
    const h = harness({
      'panel--a': { kind: 'fail', reason: 'boom', event: 'playFunctionThrewException', stack: 's' },
      'panel--b': { kind: 'timeout', lastPhase: 'rendering' },
    });
    const res = await h.inspector.check(record, { waitFor: { text: 'Go' }, timeoutMs: 1234 });
    expect(res.results[0]).toMatchObject({
      status: 'fail',
      error: { message: 'boom', event: 'playFunctionThrewException', stack: 's' },
    });
    expect(res.results[1]).toMatchObject({
      status: 'timeout',
      error: { message: expect.stringMatching(/rendering/) },
    });
    expect(res.summary).toEqual({ pass: 0, fail: 1, timeout: 1 });
    expect(h.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ waitFor: { text: 'Go' }, timeoutMs: 1234 }),
    );
  });

  it('restricts to storyIds and rejects unknown ids before touching the browser', async () => {
    const h = harness({});
    const res = await h.inspector.check(record, { storyIds: ['panel--b'] });
    expect(res.results.map((r) => r.storyId)).toEqual(['panel--b']);
    await expect(
      h.inspector.check(record, { storyIds: ['panel--zzz', 'panel--a'] }),
    ).rejects.toMatchObject({
      code: 'STORY_NOT_FOUND',
      message: expect.stringMatching(/panel--zzz/),
    });
    expect(h.acquire).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-ready instance', async () => {
    const h = harness({});
    await expect(h.inspector.check({ ...record, status: 'starting' }, {})).rejects.toMatchObject({
      code: 'INSTANCE_NOT_READY',
    });
  });

  it('closes the context even when settle throws', async () => {
    const h = harness({});
    h.settle.mockRejectedValueOnce(new Error('page crashed'));
    await expect(h.inspector.check(record, {})).rejects.toThrow(/page crashed/);
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
  });
});

describe('inspector.screenshot', () => {
  it('writes the PNG to the default path with the root clip and reports its dimensions', async () => {
    const h = harness({});
    const res = await h.inspector.screenshot(record, { storyId: 'panel--a' });
    expect(h.acquire).toHaveBeenCalledWith({ width: 1280, height: 720 });
    expect(h.shots[0]).toEqual('element');
    expect(h.writes[0].path).toBe(
      '/h/node_modules/.cache/storybrokr/inst1/screenshots/panel--a-1280x720.png',
    );
    expect(res).toMatchObject({
      instanceId: 'inst1',
      storyId: 'panel--a',
      path: h.writes[0].path,
      width: 300,
      height: 200,
    });
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('honours outPath, viewport, and the viewport/page clips; falls back to viewport when root box is empty', async () => {
    const h = harness({});
    await h.inspector.screenshot(record, {
      storyId: 'panel--a',
      outPath: '/tmp/x.png',
      viewport: { width: 640, height: 480 },
      clip: 'viewport',
    });
    expect(h.acquire).toHaveBeenLastCalledWith({ width: 640, height: 480 });
    expect(h.shots[0]).toEqual({});
    expect(h.writes[0].path).toBe('/tmp/x.png');
    await h.inspector.screenshot(record, { storyId: 'panel--a', clip: 'page' });
    expect(h.shots[1]).toEqual({ fullPage: true });
    const empty = harness({}, { x: 0, y: 0, width: 0, height: 0 });
    await empty.inspector.screenshot(record, { storyId: 'panel--a' });
    expect(empty.shots[0]).toEqual({});
  });

  it('maps fail and timeout outcomes to STORY_FAILED / STORY_TIMEOUT and writes nothing', async () => {
    const h = harness({
      'panel--a': { kind: 'fail', reason: 'nope', event: 'storyErrored' },
      'panel--b': { kind: 'timeout', lastPhase: 'loading' },
    });
    await expect(h.inspector.screenshot(record, { storyId: 'panel--a' })).rejects.toMatchObject({
      code: 'STORY_FAILED',
      message: expect.stringMatching(/nope/),
    });
    await expect(h.inspector.screenshot(record, { storyId: 'panel--b' })).rejects.toMatchObject({
      code: 'STORY_TIMEOUT',
      message: expect.stringMatching(/loading/),
    });
    expect(h.writes).toHaveLength(0);
  });

  it('maps unknown story, non-ready instance, and write failures', async () => {
    const h = harness({});
    await expect(h.inspector.screenshot(record, { storyId: 'nope' })).rejects.toMatchObject({
      code: 'STORY_NOT_FOUND',
    });
    await expect(
      h.inspector.screenshot({ ...record, status: 'failed' }, { storyId: 'panel--a' }),
    ).rejects.toMatchObject({ code: 'INSTANCE_NOT_READY' });
    h.writes.length = 0;
    const failing = createInspector({
      pool: { acquire: h.acquire },
      settle: h.settle as never,
      writeFile: async () => {
        throw new Error('EACCES');
      },
    });
    await expect(failing.screenshot(record, { storyId: 'panel--a' })).rejects.toMatchObject({
      code: 'SCREENSHOT_WRITE_FAILED',
      message: expect.stringMatching(/EACCES/),
    });
  });
});
