import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson, sleep } from './helpers.js';

describe('daemon lifecycle', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('the first command auto-starts the daemon and status reports it', async () => {
    expect((await runCli(['daemon', 'status'], { home })).stdout).toMatch(/not running/);
    await runJson<InstanceRecord[]>(['ls'], { home });
    expect((await runCli(['daemon', 'status'], { home })).stdout).toMatch(/running/);
  });

  it('a new daemon adopts a still-running instance after the old daemon is killed', async () => {
    const rec = await runJson<InstanceRecord>(
      ['up', 'src/components/Button', '--host', FIXTURE_HOST],
      { home },
    );
    const { pid } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid: number };
    process.kill(pid, 'SIGKILL'); // daemon dies; its child Storybook keeps running (detached from the daemon's fate)
    await sleep(500);
    const list = await runJson<InstanceRecord[]>(['ls'], { home }); // auto-starts a new daemon → reconcile
    expect(list.map((r) => r.id)).toEqual([rec.id]);
    expect(list[0].status).toBe('ready');
    await runCli(['down', rec.id], { home });
  });

  it('reaps an idle instance when its ttl elapses', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ reaperIntervalMs: 500 }));
    await runCli(['daemon', 'stop'], { home });
    const rec = await runJson<InstanceRecord>(
      ['up', 'src/components/Icon', '--host', FIXTURE_HOST, '--ttl', '0.02'],
      { home },
    );
    expect(rec.status).toBe('ready');
    await sleep(3000); // ttl 0.02 min = 1.2 s, reaper every 0.5 s
    expect(await runJson<InstanceRecord[]>(['ls'], { home })).toEqual([]);
  });
});
