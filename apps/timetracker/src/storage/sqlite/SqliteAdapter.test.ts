import { describe, expect, it } from 'vitest';
import { storageContract } from '../contract.js';
import { SqliteAdapter } from './SqliteAdapter.js';

// Fresh in-memory database per test (beforeEach calls makeAdapter), so each
// contract case runs in isolation. Exercises the node:sqlite driver under
// vitest and the bun:sqlite driver under `bun test`.
storageContract('SqliteAdapter (:memory:)', async () => {
  const adapter = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
  await adapter.init();
  return adapter;
});

// Transaction atomicity is the SQLite-backend guarantee that makes the router's
// claim+handle safe; not part of the shared contract (DynamoDB is pass-through).
describe('SqliteAdapter transaction', () => {
  const make = async () => {
    const a = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await a.init();
    return a;
  };

  it('commits all writes when fn resolves', async () => {
    const s = await make();
    await s.transaction(async () => {
      await s.markProcessed('m');
    });
    expect(await s.markProcessed('m')).toBe(false); // already claimed → committed
  });

  it('rolls back all writes when fn throws', async () => {
    const s = await make();
    await expect(
      s.transaction(async () => {
        await s.markProcessed('m');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await s.markProcessed('m')).toBe(true); // claim undone → reprocessable
  });
});
