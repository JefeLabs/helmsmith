/**
 * Map a canonical tool name to its platform-specific package name.
 * Looks at the merged catalog (built-in ∪ user extensions). User
 * extensions live at `~/.agentx/toolz/catalog.yaml` and override the
 * built-in for any same-name tool.
 */

import { getMergedCatalog } from '../config/catalog.js';
import type { PackageManagerType } from '../platform/types.js';
import type { CatalogEntry } from './built-in-catalog.js';

export type { CatalogEntry } from './built-in-catalog.js';
export { BUILT_IN_CATALOG } from './built-in-catalog.js';

export interface ResolvedPackage {
  /** Manager-specific package name. */
  packageName: string;
  /** The catalog entry it came from (for description / listings). */
  entry: CatalogEntry;
}

export function resolvePackageName(
  toolName: string,
  manager: PackageManagerType,
): ResolvedPackage | null {
  const catalog = getMergedCatalog();
  const entry = catalog[toolName];
  if (!entry) return null;
  const packageName = entry.packages[manager];
  if (!packageName) return null;
  return { packageName, entry };
}

/** List every canonical tool name in the merged catalog. */
export function catalogToolNames(): string[] {
  return Object.keys(getMergedCatalog()).sort();
}
