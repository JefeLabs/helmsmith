import type { Command } from 'commander';
import ora from 'ora';
import { ManifestManager } from '../config/manifest.js';
import type { RepoState } from '../config/schema.js';
import { Orchestrator } from '../core/orchestrator.js';
import {
  type ManifestRef,
  manifestRef,
  type StatusBranchDocument,
  type StatusDocument,
  type StatusRepoDocument,
  toFetchRows,
} from '../output/contract.js';
import { emitJson } from '../output/json.js';
import { Dashboard } from '../ui/dashboard.js';

type FetchResult = { repo: string; success: boolean; error?: string };

/** Build the `status --json` document (spec §4 "status"); unknown values are `null`. */
export function toStatusDocument(
  states: RepoState[],
  ctx: { manifest: ManifestRef; fetch: FetchResult[] | null; now: Date },
): StatusDocument {
  const repos = states.map((s): StatusRepoDocument => {
    const branches: Record<string, StatusBranchDocument> = {};
    for (const [alias, b] of Object.entries(s.branches)) {
      branches[alias] = {
        branch: b.branch,
        trackingBranch: b.trackingBranch ?? null,
        tracking: b.tracking,
        ahead: b.ahead,
        behind: b.behind,
        isDirty: b.error ? null : b.isDirty,
        hasConflicts: b.error ? null : b.hasConflicts,
        lastCommit: b.lastCommitSha ? { sha: b.lastCommitSha, date: b.lastCommitDate } : null,
        ...(b.error ? { error: b.error } : {}),
      };
    }
    return {
      name: s.name,
      group: s.group,
      path: s.path,
      currentBranch: s.error ? null : s.currentBranch,
      hasUnresolved: s.hasUnresolved,
      ...(s.error ? { error: s.error } : {}),
      branches,
    };
  });
  return {
    generatedAt: ctx.now.toISOString(),
    manifest: ctx.manifest,
    fetch: ctx.fetch ? toFetchRows(ctx.fetch) : null,
    repos,
    summary: {
      repos: states.length,
      withConflicts: states.filter((s) => s.hasUnresolved).length,
      withErrors: states.filter((s) => s.error).length,
    },
  };
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .alias('dash')
    .description('Show dashboard with branch states across all repos')
    .option('-g, --group <name>', 'Filter by group')
    .option('-r, --repo <name>', 'Filter by repo')
    .option('-c, --compact', 'Compact view')
    .option('--fetch', 'Fetch from remotes first', false)
    .option('--json', 'Print the branch states as one JSON line')
    .action(
      async (opts: {
        group?: string;
        repo?: string;
        compact?: boolean;
        fetch?: boolean;
        json?: boolean;
      }) => {
        const manifest = new ManifestManager();
        const orchestrator = new Orchestrator(manifest);
        const target = opts.group ?? opts.repo;

        if (opts.json) {
          const fetched = opts.fetch ? await orchestrator.repos.fetchAll(target) : null;
          const states = await orchestrator.repos.getStates(target);
          return emitJson(
            toStatusDocument(states, {
              manifest: manifestRef(manifest),
              fetch: fetched,
              now: new Date(),
            }),
          );
        }

        if (opts.fetch) {
          const spinner = ora('Fetching from remotes...').start();
          await orchestrator.repos.fetchAll(target);
          spinner.succeed('Fetched');
        }

        const states = await orchestrator.repos.getStates(target);
        Dashboard.render(states, { compact: opts.compact });
      },
    );
}
