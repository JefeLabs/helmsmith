import { describe, expect, it } from 'vitest';
import { runConnect } from './connect.js';

describe('pritty connect delegates to pritty-connect', () => {
  it('runs the separate binary when it is on PATH, passing the arguments through', async () => {
    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const code = await runConnect(['--foo'], {
      which: () => '/usr/local/bin/pritty-connect',
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(spawned).toEqual([{ cmd: '/usr/local/bin/pritty-connect', args: ['--foo'] }]);
  });

  it('explains how to install it when it is missing, without touching anything', async () => {
    let spawnedCount = 0;
    await expect(
      runConnect([], {
        which: () => null,
        spawn: () => {
          spawnedCount++;
          return 0;
        },
      }),
    ).rejects.toThrow(/npm i -g @helmsmith\/pritty-connect/);
    expect(spawnedCount).toBe(0);
  });
});
