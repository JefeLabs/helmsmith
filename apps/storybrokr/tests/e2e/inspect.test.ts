import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CheckResponse, InstanceRecord, ScreenshotResponse } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson } from './helpers.js';

describe('check and screenshot', () => {
  const { home, cleanup } = makeHome();
  let rec: InstanceRecord;

  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('check reports pass/fail per story, with played only for play stories, and exits 1 on any failure', async () => {
    rec = await runJson<InstanceRecord>(['up', 'src/components/Panel', '--host', FIXTURE_HOST], {
      home,
    });
    const r = await runCli(['check', rec.id, '--json'], { home });
    expect(r.code).toBe(1);
    const res = JSON.parse(r.stdout) as CheckResponse;
    const by = Object.fromEntries(res.results.map((x) => [x.storyId, x]));
    expect(by['organisms-panel--default']).toMatchObject({ status: 'pass', played: false });
    expect(by['organisms-panel--with-play']).toMatchObject({ status: 'pass', played: true });
    expect(by['organisms-panel--play-fails'].status).toBe('fail');
    expect(by['organisms-panel--play-fails'].error?.message).toMatch(/Not the title/);
    // No --story filter, so this checks every story discovered for the instance (Button x2,
    // Icon, and the 3 Panel stories) — 5 pass (Button, Icon, Default, WithPlay), 1 fails
    // (PlayFails), not just the 3 Panel stories.
    expect(res.summary).toEqual({ pass: 5, fail: 1, timeout: 0 });
  });

  it('check --story restricts the run and exits 0 when everything passes', async () => {
    const res = await runJson<CheckResponse>(
      ['check', rec.id, '--story', 'organisms-panel--default', '--wait-for-text', 'Go'],
      { home },
    );
    expect(res.results.map((x) => x.storyId)).toEqual(['organisms-panel--default']);
    expect(res.summary).toEqual({ pass: 1, fail: 0, timeout: 0 });
  });

  it('screenshot writes a PNG at the requested viewport to an absolute --out path', async () => {
    const out = join(home, 'shots', 'panel.png');
    const res = await runJson<ScreenshotResponse>(
      [
        'screenshot',
        'src/components/Panel',
        'organisms-panel--default',
        '--out',
        out,
        '--viewport',
        '640x480',
      ],
      { home },
    );
    expect(res.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    const buf = readFileSync(out);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBeLessThanOrEqual(640);
    expect(res.width).toBe(buf.readUInt32BE(16));
  });

  it('screenshot defaults into the instance configDir with the viewport in the name', async () => {
    const res = await runJson<ScreenshotResponse>(
      ['screenshot', rec.id, 'organisms-panel--with-play', '--clip', 'viewport'],
      { home },
    );
    expect(res.path).toBe(
      join(rec.configDir, 'screenshots', 'organisms-panel--with-play-1280x720.png'),
    );
    expect(res.width).toBe(1280);
    expect(res.height).toBe(720);
  });

  it('screenshot refuses a failing story with STORY_FAILED', async () => {
    const r = await runCli(['screenshot', rec.id, 'organisms-panel--play-fails', '--json'], {
      home,
    });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr)).toMatchObject({ code: 'STORY_FAILED' });
  });

  it('unknown story ids are rejected up front', async () => {
    const r = await runCli(['check', rec.id, '--story', 'nope--x', '--json'], { home });
    expect(r.code).toBe(1);
    const err = JSON.parse(r.stderr);
    expect(err).toMatchObject({ code: 'STORY_NOT_FOUND' });
    expect(err.message).toEqual(expect.stringMatching(/nope--x/));
  });
});
