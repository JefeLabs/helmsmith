/**
 * Validation cache — `~/.pritty/cache.json`. Stores adapter-resolved
 * ticket existence + metadata so repeat commits referencing the same
 * ticket don't re-hit the API.
 *
 * Caching policy: forever-until-cleared. Tickets either exist or
 * don't; once resolved, the answer doesn't change for the lifetime
 * of that ticket. Users with concerns about stale entries (deleted
 * tickets, instance switches) run `pritty cache clear`.
 *
 * Override the cache location via `PRITTY_HOME` env var (used by
 * tests for isolation).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ValidationType } from './index.js';

export interface CacheEntry {
  system: ValidationType;
  exists: boolean;
  title?: string;
  status?: string;
  url?: string;
  /** ISO date the API was queried. */
  validatedAt: string;
}

export interface CacheFile {
  version: 1;
  tickets: Record<string, CacheEntry>;
}

function emptyCache(): CacheFile {
  return { version: 1, tickets: {} };
}

export function getCachePath(): string {
  const home = process.env.PRITTY_HOME ?? join(homedir(), '.pritty');
  return join(home, 'cache.json');
}

function ensureCacheDir(): void {
  const path = getCachePath();
  mkdirSync(dirname(path), { recursive: true });
}

export function readCache(): CacheFile {
  const path = getCachePath();
  if (!existsSync(path)) return emptyCache();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyCache();
    return {
      version: 1,
      tickets: (parsed.tickets ?? {}) as Record<string, CacheEntry>,
    };
  } catch {
    return emptyCache();
  }
}

export function writeCache(cache: CacheFile): void {
  ensureCacheDir();
  writeFileSync(getCachePath(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

/**
 * Look up a ticket in the cache, scoped by system to avoid
 * cross-instance bleed (PROJ-123 in jira-rest A vs B).
 */
export function getCachedTicket(ticket: string, system: ValidationType): CacheEntry | null {
  const cache = readCache();
  const entry = cache.tickets[cacheKey(ticket, system)];
  return entry ?? null;
}

export function setCachedTicket(
  ticket: string,
  system: ValidationType,
  entry: Omit<CacheEntry, 'validatedAt' | 'system'>,
): void {
  const cache = readCache();
  cache.tickets[cacheKey(ticket, system)] = {
    ...entry,
    system,
    validatedAt: new Date().toISOString(),
  };
  writeCache(cache);
}

/**
 * Wipe the cache file. Used by `pritty cache clear` and by tests.
 * No-op if the file doesn't exist.
 */
export function clearCache(): void {
  const path = getCachePath();
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function cacheKey(ticket: string, system: ValidationType): string {
  return `${system}:${ticket}`;
}
