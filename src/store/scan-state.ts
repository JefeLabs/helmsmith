import { readFile, writeFile, rename } from "node:fs/promises";
import type { ScanState } from "../types/schema.js";
import { getScanStatePath, ensureDataDir } from "./paths.js";

/**
 * Inferred type for a single repo's scan state entry.
 */
export type RepoScanState = ScanState["repos"][string];

/**
 * Load scan state from disk, or return an empty default if the file
 * does not exist or cannot be parsed.
 */
export async function loadScanState(): Promise<ScanState> {
  try {
    const raw = await readFile(getScanStatePath(), "utf-8");
    return JSON.parse(raw) as ScanState;
  } catch {
    return { version: 1, repos: {} };
  }
}

/**
 * Atomically save scan state to disk.
 * Writes to a .tmp file first, then renames to avoid partial writes.
 */
export async function saveScanState(state: ScanState): Promise<void> {
  await ensureDataDir();
  const filePath = getScanStatePath();
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmpPath, filePath);
}

/**
 * Get the scan state for a specific repo, or undefined if not found.
 */
export function getRepoState(
  state: ScanState,
  repoName: string
): RepoScanState | undefined {
  return state.repos[repoName];
}

/**
 * Immutably update a repo's scan state, returning a new ScanState object.
 * The original state is never mutated.
 */
export function updateRepoState(
  state: ScanState,
  repoName: string,
  update: Partial<RepoScanState>
): ScanState {
  return {
    ...state,
    repos: {
      ...state.repos,
      [repoName]: {
        ...state.repos[repoName],
        ...update,
      } as RepoScanState,
    },
  };
}

/**
 * Returns true if the repo state is stale (undefined or elapsed time exceeds threshold).
 */
export function isStale(
  repoState: RepoScanState | undefined,
  stalenessMinutes: number
): boolean {
  if (!repoState) return true;
  const lastScan = new Date(repoState.lastScanDate).getTime();
  const now = Date.now();
  const elapsedMs = now - lastScan;
  const thresholdMs = stalenessMinutes * 60 * 1000;
  return elapsedMs > thresholdMs;
}

/**
 * Prepend new hashes to the front of recentHashes, then slice to maxSize.
 * Does not mutate the input arrays.
 */
export function rotateHashes(
  recentHashes: string[],
  newHashes: string[],
  maxSize: number = 500
): string[] {
  return [...newHashes, ...recentHashes].slice(0, maxSize);
}
