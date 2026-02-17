import { syncTaskFiles } from '../formats/sync.js';

export interface SyncOpts {
  dryRun?: boolean;
}

export interface SyncChange {
  taskId: string;
  diffs: Array<{
    field: string;
    jsonValue: unknown;
    yamlValue: unknown;
  }>;
}

export interface SyncResult {
  changes: SyncChange[];
  missingInJson: string[];
}

/**
 * Execute the sync command: merge edits from YAML task files
 * back into tasks.json.
 */
export async function executeSync(
  projectDir: string,
  opts: SyncOpts = {},
): Promise<SyncResult> {
  return syncTaskFiles(projectDir, { dryRun: opts.dryRun });
}
