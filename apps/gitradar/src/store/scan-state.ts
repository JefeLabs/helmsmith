import type { ScanState } from '../types/schema.js';

/**
 * Inferred type for a single repo's scan state entry.
 */
export type RepoScanState = ScanState['repos'][string];

/**
 * Get the scan state for a specific repo, or undefined if not found.
 */
export function getRepoState(state: ScanState, repoName: string): RepoScanState | undefined {
  return state.repos[repoName];
}

/**
 * Immutably update a repo's scan state, returning a new ScanState object.
 * The original state is never mutated.
 */
export function updateRepoState(
  state: ScanState,
  repoName: string,
  update: Partial<RepoScanState>,
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
export function isStale(repoState: RepoScanState | undefined, stalenessMinutes: number): boolean {
  if (!repoState) return true;
  const lastScan = new Date(repoState.lastScanDate).getTime();
  const now = Date.now();
  const elapsedMs = now - lastScan;
  const thresholdMs = stalenessMinutes * 60 * 1000;
  return elapsedMs > thresholdMs;
}

/**
 * Default capacity for dedup hashes. Must exceed the number of commits a repo
 * can receive inside the 1-day re-scan overlap (since = lastScanDate − 1d);
 * below that, commits beyond the cap are re-counted. 5000 × 40 chars ≈ 200 KB
 * per repo in scan_state.
 */
export const MAX_RECENT_HASHES = 5000;

/**
 * Prepend new hashes to the front of recentHashes, then slice to maxSize.
 * Does not mutate the input arrays.
 */
export function rotateHashes(
  recentHashes: string[],
  newHashes: string[],
  maxSize: number = MAX_RECENT_HASHES,
): string[] {
  return [...newHashes, ...recentHashes].slice(0, maxSize);
}
