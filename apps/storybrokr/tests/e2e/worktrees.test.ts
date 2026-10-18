import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson } from './helpers.js';

function cloneFixtureWorktree(): { host: string; cleanup: () => void } {
  const raw = mkdtempSync(join(dirname(FIXTURE_HOST), 'host-wt-'));
  const host = realpathSync(raw);
  for (const entry of ['.storybook', 'package.json', 'public', 'src', 'tsconfig.json', 'vite.config.ts']) {
    cpSync(join(FIXTURE_HOST, entry), join(host, entry), { recursive: true });
  }
  const srcNm = join(FIXTURE_HOST, 'node_modules');
  const dstNm = join(host, 'node_modules');
  mkdirSync(dstNm, { recursive: true });
  for (const item of readdirSync(srcNm)) {
    if (item === '.cache') continue;
    symlinkSync(join(srcNm, item), join(dstNm, item));
  }
  return { host, cleanup: () => rmSync(host, { recursive: true, force: true }) };
}

describe('multi-worktree isolation and host scoping', () => {
  const { home, cleanup: cleanupHome } = makeHome();
  const wtB = cloneFixtureWorktree();

  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    wtB.cleanup();
    cleanupHome();
  });

  it('boots the same component in two worktrees simultaneously, disambiguates via --host, STORYBROKR_HOST, and cwd, and refuses ambiguous bare paths', async () => {
    const [recA, recB] = await Promise.all([
      runJson<InstanceRecord>(['up', 'src/components/Button', '--host', FIXTURE_HOST], { home }),
      runJson<InstanceRecord>(['up', 'src/components/Button', '--host', wtB.host], { home }),
    ]);

    expect(recA.id).not.toBe(recB.id);
    expect(recA.port).not.toBe(recB.port);

    // Unscoped bare path from outside both worktrees fails with INSTANCE_AMBIGUOUS
    const ambig = await runCli(['get', 'src/components/Button', '--json'], { home });
    expect(ambig.code).toBe(1);
    expect(JSON.parse(ambig.stderr)).toMatchObject({ code: 'INSTANCE_AMBIGUOUS' });

    // --host disambiguates
    const gotA = await runJson<InstanceRecord>(
      ['get', 'src/components/Button', '--host', FIXTURE_HOST],
      { home },
    );
    expect(gotA.id).toBe(recA.id);

    // STORYBROKR_HOST disambiguates without --host
    const gotB = await runJson<InstanceRecord>(['get', 'src/components/Button'], {
      home,
      env: { STORYBROKR_HOST: wtB.host },
    });
    expect(gotB.id).toBe(recB.id);

    // cwd inside wtB disambiguates via hint
    const gotByCwd = await runJson<InstanceRecord>(['get', 'src/components/Button'], {
      home,
      cwd: wtB.host,
    });
    expect(gotByCwd.id).toBe(recB.id);

    // ls --host filters to one worktree
    const listB = await runJson<InstanceRecord[]>(['ls', '--host', wtB.host], { home });
    expect(listB.map((r) => r.id)).toEqual([recB.id]);

    // down --host stops only wtB's instance, leaving FIXTURE_HOST's instance running
    const downB = await runJson<{ stopped: string[] }>(['down', '--host', wtB.host], { home });
    expect(downB.stopped).toEqual([recB.id]);

    const remaining = await runJson<InstanceRecord[]>(['ls'], { home });
    expect(remaining.map((r) => r.id)).toEqual([recA.id]);

    await runCli(['down', '--host', FIXTURE_HOST], { home });
    expect(await runJson<InstanceRecord[]>(['ls'], { home })).toEqual([]);
  });
});
