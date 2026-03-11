import type { Config, Org, UserWeekRepoRecord, ScanState, AuthorRegistry, EnrichmentStore } from '../types/schema.js';

export interface ViewContext {
  config: Config;
  records: UserWeekRepoRecord[];
  currentWeek: string;
  scanState?: ScanState;
  authorRegistry?: AuthorRegistry;
  enrichments?: EnrichmentStore;
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
}

export type NavigationAction =
  | { type: 'push'; view: ViewFn }
  | { type: 'pop' }
  | { type: 'replace'; view: ViewFn }
  | { type: 'quit' };

export type ViewFn = (ctx: ViewContext) => Promise<NavigationAction>;
