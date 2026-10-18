import { describe, expect, it, vi } from 'vitest';
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
