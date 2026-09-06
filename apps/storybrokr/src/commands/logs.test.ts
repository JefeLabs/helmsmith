import { describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '../client/index.js';
import { StorybrokrError } from '../lib/errors.js';
import { followLogs } from './logs.js';

describe('followLogs', () => {
  it('propagates a follow() rejection to the caller without calling onSignal', async () => {
    const follow = vi.fn(async () => {
      throw new StorybrokrError('DAEMON_UNAVAILABLE', 'gone');
    });
    const client = { follow } as unknown as Pick<DaemonClient, 'follow'>;
    const onSignal = vi.fn();
    const onLine = vi.fn();
    await expect(followLogs(client, 'r1', onLine, onSignal)).rejects.toMatchObject({
      code: 'DAEMON_UNAVAILABLE',
    });
    expect(onSignal).not.toHaveBeenCalled();
  });

  it('resolves once the stream ends, after delivering lines and calling onSignal with the closer', async () => {
    const stop = vi.fn();
    const follow = vi.fn(
      async (_id: string, onLine: (line: string) => void, onEnd?: () => void) => {
        onLine('one');
        onLine('two');
        onEnd?.();
        return stop;
      },
    );
    const client = { follow } as unknown as Pick<DaemonClient, 'follow'>;
    const onSignal = vi.fn();
    const seen: string[] = [];
    await followLogs(client, 'r1', (line) => seen.push(line), onSignal);
    expect(seen).toEqual(['one', 'two']);
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith(stop);
  });
});
