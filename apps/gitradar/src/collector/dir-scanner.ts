import { readdir, access } from "node:fs/promises";
import path from "node:path";

/**
 * A git repository discovered by scanning a directory.
 */
export interface DiscoveredRepo {
  /** Absolute path to the repo root. */
  path: string;
  /** Directory name, used as the default repo name. */
  name: string;
}

/**
 * Scan a directory for git repositories up to `maxDepth` levels deep.
 *
 * At each level, checks for a `.git` subdirectory. Stops descending
 * into a directory once a `.git` is found (no nested repo scanning).
 *
 * Returns repos sorted alphabetically by name.
 */
export async function scanDirectory(
  dirPath: string,
  maxDepth: number = 1,
): Promise<DiscoveredRepo[]> {
  const repos: DiscoveredRepo[] = [];
  await walk(dirPath, 0, maxDepth, repos);
  repos.sort((a, b) => a.name.localeCompare(b.name));
  return repos;
}

async function walk(
  dir: string,
  currentDepth: number,
  maxDepth: number,
  results: DiscoveredRepo[],
): Promise<void> {
  if (currentDepth >= maxDepth) return;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // can't read directory — skip
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue; // skip hidden dirs

    const childPath = path.join(dir, entry.name);
    const gitPath = path.join(childPath, ".git");

    let isRepo = false;
    try {
      await access(gitPath);
      isRepo = true;
    } catch {
      // not a git repo at this level
    }

    if (isRepo) {
      results.push({ path: childPath, name: entry.name });
      // Don't descend into repos — no submodule scanning
    } else {
      await walk(childPath, currentDepth + 1, maxDepth, results);
    }
  }
}
