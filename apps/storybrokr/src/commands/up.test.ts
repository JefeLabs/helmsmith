import { describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '../client/index.js';
import type { InstanceRecord } from '../types.js';
import { runUp } from './up.js';

const rec = {
  id: 'abc',
  status: 'ready',
  url: 'http://127.0.0.1:6100',
  stories: [],
  storyFiles: [],
  component: 'src/Button',
  hostRoot: '/h',
} as unknown as InstanceRecord;

describe('runUp', () => {
  it('sends component + hostRoot + ttl + includeChildren + wait to the client and returns the record', async () => {
    const up = vi.fn(async () => ({ record: rec, created: true }));
    const client = { up } as unknown as DaemonClient;
    const out = await runUp(client, {
      component: 'src/Button',
      hostRoot: '/h',
      ttl: 5,
      includeChildren: true,
      wait: false,
    });
    expect(up).toHaveBeenCalledWith({
      component: 'src/Button',
      hostRoot: '/h',
      ttlMinutes: 5,
      includeChildren: true,
      wait: false,
    });
    expect(out).toEqual({ record: rec, created: true });
  });
});

describe('resolveUpTarget', () => {
  it('prefers --host, then STORYBROKR_HOST, then the cwd walk', async () => {
    const { resolveUpTarget } = await import('./up.js');
    const { resolve } = await import('node:path');
    expect(resolveUpTarget('src/Button', '/explicit', { STORYBROKR_HOST: '/env' })).toEqual({
      component: 'src/Button',
      hostRoot: resolve('/explicit'),
    });
    expect(resolveUpTarget('src/Button/', undefined, { STORYBROKR_HOST: '/env' })).toEqual({
      component: 'src/Button',
      hostRoot: resolve('/env'),
    });
    expect(() => resolveUpTarget('/nonexistent/path/x', undefined, {})).toThrow(
      /HOST_NOT_FOUND|no \.storybook/,
    );
  });
});
