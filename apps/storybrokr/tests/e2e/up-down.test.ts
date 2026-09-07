import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson } from './helpers.js';

describe('storybrokr up / ls / get / logs / down against the fixture host', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('boots Panel with its Button and Icon children and reports story URLs', async () => {
    const t0 = Date.now();
    const record = await runJson<InstanceRecord>(
      ['up', 'src/components/Panel', '--host', FIXTURE_HOST],
      { home },
    );
    console.log(`fixture up ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    expect(record.status).toBe('ready');
    expect(record.storyFiles).toEqual([
      'src/components/Button/Button.stories.tsx',
      'src/components/Icon/Icon.stories.tsx',
      'src/components/Panel/Panel.stories.tsx',
    ]);
    const ids = record.stories.map((s) => s.id).sort();
    expect(ids).toEqual([
      'atoms-button--primary',
      'atoms-button--secondary',
      'atoms-icon--star',
      'organisms-panel--default',
      'organisms-panel--play-fails',
      'organisms-panel--with-play',
    ]);
    expect(record.stories[0].iframeUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/iframe\.html\?id=.*&viewMode=story$/,
    );
    expect(existsSync(join(record.configDir, 'main.ts'))).toBe(true);
    const iframe = await fetch(
      record.stories.find((s) => s.id === 'organisms-panel--default')?.iframeUrl ?? '',
    );
    expect(iframe.status).toBe(200);
  });

  it('a second up reuses the instance; ls and get see it; logs has the banner', async () => {
    const again = await runJson<InstanceRecord>(
      ['up', 'src/components/Panel', '--host', FIXTURE_HOST],
      { home },
    );
    const list = await runJson<InstanceRecord[]>(['ls'], { home });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(again.id);
    const got = await runJson<InstanceRecord>(['get', again.id], { home });
    expect(got.stories.length).toBe(6);
    const logs = await runCli(['logs', again.id, '--tail', '500'], { home });
    expect(logs.stdout).toMatch(/Local:/);
  });

  it('down stops it and removes the config dir', async () => {
    const [rec] = await runJson<InstanceRecord[]>(['ls'], { home });
    const down = await runCli(['down', rec.id], { home });
    expect(down.code).toBe(0);
    expect(existsSync(rec.configDir)).toBe(false);
    expect(await runJson<InstanceRecord[]>(['ls'], { home })).toEqual([]);
    await expect(fetch(`${rec.url}/index.json`)).rejects.toThrow();
  });

  it('reports COMPONENT_NOT_FOUND for a path without stories', async () => {
    const r = await runCli(['up', 'src/nothing-here', '--host', FIXTURE_HOST, '--json'], { home });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr)).toMatchObject({ code: 'COMPONENT_NOT_FOUND' });
  });
});
