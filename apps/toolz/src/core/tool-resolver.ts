/**
 * Map a canonical tool name to its platform-specific package name.
 * Some tools have the same name everywhere (`git` → `git` on every
 * manager); others diverge (`fd` is `fd` on brew but `fd-find` on apt;
 * GitHub CLI is `gh` on brew but `GitHub.cli` on winget).
 *
 * Phase 3 ships with a small inline catalog covering the most-used
 * tools. Phase 4 will replace this with a YAML-backed built-in catalog
 * plus user extensions in `~/.agentx/toolz/catalog.yaml`.
 */

import type { PackageManagerType } from "../platform/types.js";

export interface CatalogEntry {
  /** Human description shown in `toolz catalog` listings. */
  description: string;
  /** Map from package manager type → package name. */
  packages: Partial<Record<PackageManagerType, string>>;
}

/**
 * Built-in catalog. Add entries here for tools the AgentX ecosystem
 * commonly depends on. Names that match across managers (most tools)
 * keep the entry small; names that diverge spell out each manager's
 * package name.
 */
export const BUILT_IN_CATALOG: Record<string, CatalogEntry> = {
  git: {
    description: "Distributed version control system",
    packages: { brew: "git", apt: "git", winget: "Git.Git" },
  },
  gh: {
    description: "GitHub CLI",
    packages: { brew: "gh", apt: "gh", winget: "GitHub.cli" },
  },
  jq: {
    description: "JSON processor",
    packages: { brew: "jq", apt: "jq", winget: "stedolan.jq" },
  },
  yq: {
    description: "YAML processor",
    packages: { brew: "yq", apt: "yq", winget: "MikeFarah.yq" },
  },
  ripgrep: {
    description: "Fast text search (rg)",
    packages: {
      brew: "ripgrep",
      apt: "ripgrep",
      winget: "BurntSushi.ripgrep.MSVC",
    },
  },
  fd: {
    description: "Fast find alternative",
    packages: {
      brew: "fd",
      // apt names this differently because `fd` collides with another package
      apt: "fd-find",
      winget: "sharkdp.fd",
    },
  },
  pandoc: {
    description: "Document converter",
    packages: { brew: "pandoc", apt: "pandoc", winget: "JohnMacFarlane.Pandoc" },
  },
  ffmpeg: {
    description: "Audio/video processing",
    packages: { brew: "ffmpeg", apt: "ffmpeg", winget: "Gyan.FFmpeg" },
  },
};

export interface ResolvedPackage {
  /** Manager-specific package name. */
  packageName: string;
  /** The catalog entry it came from (for description / listings). */
  entry: CatalogEntry;
}

/**
 * Resolve a canonical tool name + manager type to the manager's
 * package name. Returns null when the tool isn't in the catalog OR
 * when the catalog has no entry for that specific manager.
 */
export function resolvePackageName(
  toolName: string,
  manager: PackageManagerType,
): ResolvedPackage | null {
  const entry = BUILT_IN_CATALOG[toolName];
  if (!entry) return null;
  const packageName = entry.packages[manager];
  if (!packageName) return null;
  return { packageName, entry };
}

/** List every canonical tool name in the catalog. */
export function catalogToolNames(): string[] {
  return Object.keys(BUILT_IN_CATALOG).sort();
}
