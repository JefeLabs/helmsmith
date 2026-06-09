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
