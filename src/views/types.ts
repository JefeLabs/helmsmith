import type { Config, Org, UserWeekRepoRecord, ScanState, AuthorRegistry } from '../types/schema.js';

export interface ViewContext {
  config: Config;
  records: UserWeekRepoRecord[];
  currentWeek: string;
  scanState?: ScanState;
  authorRegistry?: AuthorRegistry;
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
}

export type NavigationAction =
  | { type: 'push'; view: ViewFn }
  | { type: 'pop' }
  | { type: 'replace'; view: ViewFn }
  | { type: 'quit' };

export type ViewFn = (ctx: ViewContext) => Promise<NavigationAction>;
