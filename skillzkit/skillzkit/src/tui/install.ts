import type { Catalog } from "../types.js";
import {
  installSlugs,
  type InstallOptions,
  type InstallResult,
} from "../install.js";
import type { ResolvedSelection } from "./state.js";

export type { InstallResult } from "../install.js";

/**
 * TUI adapter over the shared `installSlugs()` primitive in lib/install.ts.
 * Flattens the TUI's `ResolvedSelection { selected, locked }` into a slug
 * set and delegates — the actual file copying, always-install infra, and
 * runtime-manifest writing all live in lib/ so the CLI and TUI install
 * paths produce identical output.
 */
export function installSelection(
  resolved: ResolvedSelection,
  catalog: Catalog,
  packageRoot: string,
  targetDir: string,
  options: InstallOptions = {},
): InstallResult {
  const slugs = new Set([...resolved.selected, ...resolved.locked]);
  return installSlugs(slugs, catalog, packageRoot, targetDir, options);
}
