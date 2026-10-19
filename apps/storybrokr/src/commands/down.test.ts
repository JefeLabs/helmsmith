import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '../client/index.js';
import type { InstanceRecord } from '../types.js';
import { runDown, selectDownTargets } from './down.js';

const rec = (id: string) => ({ id }) as InstanceRecord;

describe('selectDownTargets', () => {
  it('returns every id when --all is given, even with zero running instances', () => {
    expect(selectDownTargets([], undefined, true)).toEqual([]);
    expect(selectDownTargets([rec('a'), rec('b')], undefined, true)).toEqual(['a', 'b']);
  });

  it('returns the single target when an id/path is given', () => {
    expect(selectDownTargets([], 'abc', false)).toEqual(['abc']);
  });

  it('throws when neither --all, --host, nor an id/path is given', () => {
    expect(() => selectDownTargets([], undefined, false)).toThrow(
      /give an instance id\/path, --host <dir>, or --all/,
    );
  });

  it('runDown calls downByHost when --host is passed without an id/path', async () => {
    const downByHost = vi.fn(async () => ['a1', 'a2']);
    const client = { downByHost } as unknown as DaemonClient;
    const stopped = await runDown(client, undefined, { host: '/wt-a/app-ui' });
    expect(downByHost).toHaveBeenCalledWith('/wt-a/app-ui');
    expect(stopped).toEqual(['a1', 'a2']);
  });
});

describe('runDown with --all and --host', () => {
  it('stops only the instances in that host, never every instance on the machine', async () => {
    const downByHost = vi.fn(async () => ['a1']);
    const list = vi.fn(async () => [rec('a1'), rec('b1')]);
    const down = vi.fn(async () => undefined);
    const client = { downByHost, list, down } as unknown as DaemonClient;
    const stopped = await runDown(client, undefined, { all: true, host: '/wt-a/app-ui' });
    expect(downByHost).toHaveBeenCalledWith('/wt-a/app-ui');
    expect(list).not.toHaveBeenCalled();
    expect(down).not.toHaveBeenCalled();
    expect(stopped).toEqual(['a1']);
  });
});

describe('S11 and --if-running', () => {
  const saved = process.env.STORYBROKR_HOST;
  afterEach(() => {
    if (saved === undefined) delete process.env.STORYBROKR_HOST;
    else process.env.STORYBROKR_HOST = saved;
  });

  it('down treats STORYBROKR_HOST as the host, never falling through to another worktree', async () => {
    process.env.STORYBROKR_HOST = '/wt-a/app-ui';
    const down = vi.fn(async () => undefined);
    const client = { down } as unknown as DaemonClient;
    await runDown(client, 'src/Button', {});
    const { realpathOrResolve } = await import('../lib/host.js');
    expect(down).toHaveBeenCalledWith('src/Button', {
      host: realpathOrResolve('/wt-a/app-ui'),
      hint: undefined,
    });
  });

  it('--if-running reports nothing stopped when no daemon is listening, without starting one', async () => {
    const { downIfRunning } = await import('./down.js');
    const { StorybrokrError } = await import('../lib/errors.js');
    const connect = vi.fn(async () => {
      throw new StorybrokrError('DAEMON_UNAVAILABLE', 'none');
    });
    expect(await downIfRunning(connect, undefined, { host: '/wt-a' })).toEqual([]);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
