/**
 * Catalog loader — merges the built-in inline catalog with the user's
 * extensions at `~/.agentx/toolz/catalog.yaml`. User entries override
 * built-in ones for the same tool name; user-only entries add new
 * tools.
 *
 * This is the single source of truth for `resolvePackageName` (which
 * gets re-pointed at this loader). Phase 4 keeps the built-in inline
 * in TS; later phases may externalize it to a packaged YAML file
 * inside dist/.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { parse } from 'yaml';
import { BUILT_IN_CATALOG, type CatalogEntry } from '../core/built-in-catalog.js';
import { getUserCatalogPath } from './paths.js';

let mergedCache: Record<string, CatalogEntry> | undefined;
let userMtimeCache: number | undefined;

/**
 * Read the user's catalog YAML. Returns an empty object when the file
 * is missing, unparseable, or has the wrong shape. Errors are
 * swallowed: the user can fix their YAML and re-run; toolz never
 * blocks on a malformed user catalog.
 */
export function loadUserCatalog(): Record<string, CatalogEntry> {
  const path = getUserCatalogPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const tools = (parsed as { tools?: unknown }).tools;
    if (!tools || typeof tools !== 'object') return {};
    return tools as Record<string, CatalogEntry>;
  } catch {
    return {};
  }
}

/**
 * Merged catalog: built-in entries overlaid with user entries. Cached
 * by user-catalog mtime so subsequent calls are O(1) when the file
 * hasn't changed.
 */
export function getMergedCatalog(): Record<string, CatalogEntry> {
  const path = getUserCatalogPath();
  let mtime: number | undefined;
  if (existsSync(path)) {
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      mtime = undefined;
    }
  }

  if (mergedCache && userMtimeCache === mtime) return mergedCache;

  const user = loadUserCatalog();
  mergedCache = { ...BUILT_IN_CATALOG, ...user };
  userMtimeCache = mtime;
  return mergedCache;
}

/** Test helper — clears the merge cache. */
export function _resetCatalogCache(): void {
  mergedCache = undefined;
  userMtimeCache = undefined;
}
