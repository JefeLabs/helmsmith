import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { ComponentIndex, EntryPointIndex, SymbolIndex } from '../parser/analysis/types.js';
import {
  ComponentIndexSchema,
  EntryPointIndexSchema,
  SymbolIndexSchema,
} from '../parser/analysis/types.js';

const COMPONENT_INDEX_FILENAME = 'component-index.json';
const SYMBOL_INDEX_FILENAME = 'symbol-index.json';
const ENTRYPOINT_INDEX_FILENAME = 'entrypoint-index.json';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read and validate component-index.json for a repo home directory.
 * Returns null if the file does not exist.
 */
export async function readComponentIndex(repoHome: string): Promise<ComponentIndex | null> {
  const indexPath = join(repoHome, COMPONENT_INDEX_FILENAME);

  if (!existsSync(indexPath)) {
    return null;
  }

  const content = await readFile(indexPath, 'utf-8');
  const parsed = JSON.parse(content);
  return ComponentIndexSchema.parse(parsed);
}

/**
 * Atomically write a component index to component-index.json with file locking.
 *
 * Steps:
 * 1. Validate with Zod before writing
 * 2. Acquire lock on component-index.json
 * 3. Write to component-index.json.tmp
 * 4. Rename component-index.json.tmp -> component-index.json (atomic on POSIX)
 * 5. Release lock
 *
 * Retries up to MAX_RETRIES times if the lock is held.
 */
export async function writeComponentIndex(repoHome: string, index: ComponentIndex): Promise<void> {
  ComponentIndexSchema.parse(index);

  const indexPath = join(repoHome, COMPONENT_INDEX_FILENAME);
  const tmpPath = join(repoHome, `${COMPONENT_INDEX_FILENAME}.tmp`);

  if (!existsSync(indexPath)) {
    await writeFile(indexPath, '{}', 'utf-8');
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const release = await lockfile.lock(indexPath, {
        retries: { retries: 2, minTimeout: 100, maxTimeout: 500 },
      });

      try {
        const content = JSON.stringify(index, null, 2);
        await writeFile(tmpPath, content, 'utf-8');
        await rename(tmpPath, indexPath);
      } finally {
        await release();
      }

      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw new Error(
    `Failed to write ${COMPONENT_INDEX_FILENAME} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

/**
 * Read and validate symbol-index.json for a repo home directory.
 * Returns null if the file does not exist.
 */
export async function readSymbolIndex(repoHome: string): Promise<SymbolIndex | null> {
  const indexPath = join(repoHome, SYMBOL_INDEX_FILENAME);

  if (!existsSync(indexPath)) {
    return null;
  }

  const content = await readFile(indexPath, 'utf-8');
  const parsed = JSON.parse(content);
  return SymbolIndexSchema.parse(parsed);
}

/**
 * Atomically write a symbol index to symbol-index.json with file locking.
 *
 * Steps:
 * 1. Validate with Zod before writing
 * 2. Acquire lock on symbol-index.json
 * 3. Write to symbol-index.json.tmp
 * 4. Rename symbol-index.json.tmp -> symbol-index.json (atomic on POSIX)
 * 5. Release lock
 *
 * Retries up to MAX_RETRIES times if the lock is held.
 */
export async function writeSymbolIndex(repoHome: string, index: SymbolIndex): Promise<void> {
  SymbolIndexSchema.parse(index);

  const indexPath = join(repoHome, SYMBOL_INDEX_FILENAME);
  const tmpPath = join(repoHome, `${SYMBOL_INDEX_FILENAME}.tmp`);

  if (!existsSync(indexPath)) {
    await writeFile(indexPath, '{}', 'utf-8');
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const release = await lockfile.lock(indexPath, {
        retries: { retries: 2, minTimeout: 100, maxTimeout: 500 },
      });

      try {
        const content = JSON.stringify(index, null, 2);
        await writeFile(tmpPath, content, 'utf-8');
        await rename(tmpPath, indexPath);
      } finally {
        await release();
      }

      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw new Error(
    `Failed to write ${SYMBOL_INDEX_FILENAME} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

/**
 * Read and validate entrypoint-index.json for a home directory.
 * Returns null if the file does not exist.
 */
export async function readEntryPointIndex(home: string): Promise<EntryPointIndex | null> {
  const indexPath = join(home, ENTRYPOINT_INDEX_FILENAME);

  if (!existsSync(indexPath)) {
    return null;
  }

  const content = await readFile(indexPath, 'utf-8');
  const parsed = JSON.parse(content);
  return EntryPointIndexSchema.parse(parsed);
}

/**
 * Atomically write an entry point index to entrypoint-index.json with file locking.
 */
export async function writeEntryPointIndex(home: string, index: EntryPointIndex): Promise<void> {
  EntryPointIndexSchema.parse(index);

  const indexPath = join(home, ENTRYPOINT_INDEX_FILENAME);
  const tmpPath = join(home, `${ENTRYPOINT_INDEX_FILENAME}.tmp`);

  if (!existsSync(indexPath)) {
    await writeFile(indexPath, '{}', 'utf-8');
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const release = await lockfile.lock(indexPath, {
        retries: { retries: 2, minTimeout: 100, maxTimeout: 500 },
      });

      try {
        const content = JSON.stringify(index, null, 2);
        await writeFile(tmpPath, content, 'utf-8');
        await rename(tmpPath, indexPath);
      } finally {
        await release();
      }

      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw new Error(
    `Failed to write ${ENTRYPOINT_INDEX_FILENAME} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}
