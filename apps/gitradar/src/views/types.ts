import type { Config, Org, UserWeekRepoRecord, ScanState, AuthorRegistry, EnrichmentStore } from '../types/schema.js';
import type { RolledUp, RollupFilters, RollupGroupBy } from '../store/sqlite-store.js';

export interface ViewContext {
  config: Config;
  records: UserWeekRepoRecord[];
  currentWeek: string;
  scanState?: ScanState;
  authorRegistry?: AuthorRegistry;
  enrichments?: EnrichmentStore;
  /** SQL-accelerated rollup. When available, views should prefer this over
   *  in-memory rollup() for better performance with large datasets. */
  queryRollup?: (filters: RollupFilters, groupBy: RollupGroupBy) => Map<string, RolledUp>;
  /** Scan a single repo by name. Returns updated records + scan state. */
  onScanRepo?: (repoName: string) => Promise<{
    records: UserWeekRepoRecord[];
    scanState: ScanState;
  }>;
  /** Scan a directory for git repos and add them to the workspace. Returns count added. */
  onScanDir?: (dirPath: string, group: string, depth: number) => Promise<number>;
  /** Remove a repo from the workspace and persist. */
  onRemoveRepo?: (repoName: string) => Promise<void>;
  /** Add an organization and persist to config.yml. */
  onAddOrg?: (org: Org) => Promise<void>;
  /** Persist updated author registry to disk. */
  onSaveAuthorRegistry?: (registry: AuthorRegistry) => Promise<void>;
  /** Check if underlying data has changed and reload if so. Returns true if data was refreshed. */
  onRefreshData?: () => boolean;
  /** Create an AbortSignal that fires when the database file changes on disk.
   *  Pass to readKeyWithTimeout to interrupt the poll interval immediately. */
  createRefreshSignal?: () => AbortSignal;
}

export type NavigationAction =
  | { type: 'push'; view: ViewFn }
  | { type: 'pop' }
  | { type: 'replace'; view: ViewFn }
  | { type: 'quit' };

export type ViewFn = (ctx: ViewContext) => Promise<NavigationAction>;
