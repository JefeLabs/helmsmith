/**
 * Storage factory. Reads the validated `StorageConfig` discriminated union and
 * returns an initialised adapter. Dynamic `import()` keeps each backend's deps
 * (bun:sqlite/node:sqlite vs the AWS SDK) off the startup path of the other.
 */
import type { StorageConfig } from '../config/schema.js';
import type { StorageAdapter } from './StorageAdapter.js';

export async function createStorage(cfg: StorageConfig): Promise<StorageAdapter> {
  const adapter = await build(cfg);
  await adapter.init();
  return adapter;
}

function build(cfg: StorageConfig): Promise<StorageAdapter> {
  switch (cfg.backend) {
    case 'dynamodb':
      return import('./dynamo/DynamoAdapter.js').then((m) => new m.DynamoAdapter(cfg));
    case 'sqlite':
      return import('./sqlite/SqliteAdapter.js').then((m) => new m.SqliteAdapter(cfg));
    default: {
      // Exhaustiveness: a new backend variant must be handled here.
      const _never: never = cfg;
      throw new Error(`unknown storage backend: ${JSON.stringify(_never)}`);
    }
  }
}
