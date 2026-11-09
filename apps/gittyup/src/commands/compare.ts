import chalk from 'chalk';
import type { Command } from 'commander';
import type { CompareRow, PRInfo } from '../config/index.js';
import { ManifestManager } from '../config/index.js';
import { CliCache, Orchestrator } from '../core/index.js';
import { GitHubClient } from '../github/index.js';
import type { CompareDocument } from '../output/contract.js';
import { emitJson } from '../output/json.js';
import { gatherCompareData, renderCompare } from '../ui/index.js';

/**
 * Look up the open PR (right → left) for every GitHub repo in `rows`. Nothing is
 * thrown: a failure to reach GitHub at all is `error`, and a repo whose own lookup
 * failed (401, 404, rate limit) is in `errors`, so its missing PR reads as unknown,
 * not as "no PR".
 */
export async function lookupPrs(
  rows: CompareRow[],
  left: string,
  right: string,
): Promise<{ prs: Map<string, PRInfo>; errors: Map<string, string>; error?: string }> {
  const prs = new Map<string, PRInfo>();
  const errors = new Map<string, string>();
  try {
    const gh = await GitHubClient.create();
    for (const row of rows) {
      if (!row.repo.url?.includes('github.com')) continue;
      try {
        const { owner, repo: repoName } = await gh.getRepoOwner(row.repo.url!);
        const rightRef = row.repo.branches[right] ?? right;
        const leftRef = row.repo.branches[left] ?? left;
        const existing = await gh.findExistingPR(owner, repoName, rightRef, leftRef);
        if (existing)
          prs.set(row.repo.name, {
            number: existing.number,
            state: 'open',
            url: existing.html_url,
            date: existing.created_at.slice(0, 10),
          });
      } catch (err) {
        errors.set(row.repo.name, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    return { prs, errors, error: err instanceof Error ? err.message : String(err) };
  }
  return { prs, errors };
}

/** Build the `compare --json` document (spec §4 "compare") from rows, never rendered text. */
export function toCompareDocument(
  rows: CompareRow[],
  ctx: {
    left: string;
    right: string;
    checkConflicts: boolean;
    cache: CompareDocument['cache'];
    prLookup: CompareDocument['prLookup'];
    prs: Map<string, PRInfo> | undefined;
    prErrors?: Map<string, string>;
  },
): CompareDocument {
  const repos = rows.map((row) => {
    const prError = ctx.prErrors?.get(row.repo.name);
    // The merge-tree check only runs when both sides exist; anything else left the
    // gathered `false` in place, which would read as "checked, no conflicts".
    const checked = ctx.checkConflicts && row.left !== null && row.right !== null && !row.error;
    return {
      name: row.repo.name,
      group: row.repo.group,
      url: row.repo.url ?? null,
      leftRef: row.repo.branches[ctx.left] ?? ctx.left,
      rightRef: row.repo.branches[ctx.right] ?? ctx.right,
      hasConflicts: checked ? row.hasConflicts : null,
      left: row.left,
      right: row.right,
      pr: ctx.prs?.get(row.repo.name) ?? row.pr ?? null,
      ...(prError ? { prError } : {}),
      ...(row.error ? { error: row.error } : {}),
    };
  });
  return {
    left: ctx.left,
    right: ctx.right,
    cache: ctx.cache,
    repos,
    prLookup: ctx.prLookup,
    summary: {
      repos: repos.length,
      withConflicts: repos.filter((r) => r.hasConflicts === true).length,
      clean: repos.filter((r) => r.hasConflicts === false && !r.error).length,
    },
  };
}

export function registerCompare(program: Command): void {
  program
    .command('compare')
    .alias('cmp')
    .description('Compare two branches side-by-side with conflict detection')
    .argument('<left>', 'Left branch (or alias)')
    .argument('<right>', 'Right branch (or alias)')
    .option('-g, --group <name>', 'Filter by group')
    .option('-r, --repo <name>', 'Filter by repo')
    .option('--fetch', 'Fetch from remotes first', false)
    .option('--no-conflicts', 'Skip conflict detection')
    .option('--no-pr', 'Skip PR lookup from GitHub')
    .option('-f, --force', 'Bypass cache and force fresh data', false)
    .option('--json', 'Print the comparison as one JSON line')
    .action(
      async (
        left: string,
        right: string,
        opts: {
          group?: string;
          repo?: string;
          fetch?: boolean;
          conflicts?: boolean;
          pr?: boolean;
          force?: boolean;
          json?: boolean;
        },
      ) => {
        const manifest = new ManifestManager();
        const orchestrator = new Orchestrator(manifest);
        const target = opts.group ?? opts.repo;
        const checkConflicts = opts.conflicts !== false;

        // Cache check
        const cache = new CliCache();
        cache.prune();

        const cacheKey = CliCache.buildKey('compare', {
          // Namespace by the resolved manifest, so one workspace is never served another
          // workspace's cached compare rows (G24).
          manifest: manifest.manifestPath,
          left,
          right,
          group: opts.group,
          repo: opts.repo,
          conflicts: opts.conflicts,
          pr: opts.pr,
        });

        if (!opts.force && !opts.fetch) {
          const cached = cache.get<{
            rows: CompareRow[];
            prData: Record<string, PRInfo> | null;
            prError?: string;
            prErrors?: Record<string, string>;
          }>(cacheKey);
          if (cached.hit) {
            const prMap = cached.data.prData
              ? new Map(Object.entries(cached.data.prData))
              : undefined;
            if (opts.json) {
              return emitJson(
                toCompareDocument(cached.data.rows, {
                  left,
                  right,
                  checkConflicts,
                  cache: { hit: true, ageMs: cached.ageMs },
                  prLookup:
                    opts.pr === false
                      ? { ran: false }
                      : cached.data.prError
                        ? { ran: true, error: cached.data.prError }
                        : { ran: true },
                  prs: prMap,
                  prErrors: new Map(Object.entries(cached.data.prErrors ?? {})),
                }),
              );
            }
            CliCache.printCacheNotice(cached.ageMs);
            renderCompare(cached.data.rows, left, right, prMap);
            return;
          }
        }

        const rows = await gatherCompareData(manifest, orchestrator.repos, target, left, right, {
          fetch: opts.fetch,
          checkConflicts: opts.conflicts,
        });

        // PR lookup (on by default)
        let prData: Map<string, PRInfo> | undefined;
        let prError: string | undefined;
        let prErrors = new Map<string, string>();
        if (opts.pr !== false) {
          const lookup = await lookupPrs(rows, left, right);
          prData = lookup.prs;
          prError = lookup.error;
          prErrors = lookup.errors;
          if (prError && !opts.json) {
            console.log(chalk.yellow(`  Could not fetch PR data: ${prError}`));
          }
        }

        // Cache result
        cache.set(
          cacheKey,
          {
            rows,
            prData: prData ? Object.fromEntries(prData.entries()) : null,
            ...(prError ? { prError } : {}),
            ...(prErrors.size > 0 ? { prErrors: Object.fromEntries(prErrors) } : {}),
          },
          { command: 'compare', args: [left, right] },
        );

        if (opts.json) {
          return emitJson(
            toCompareDocument(rows, {
              left,
              right,
              checkConflicts,
              cache: { hit: false, ageMs: null },
              prLookup:
                opts.pr === false
                  ? { ran: false }
                  : prError
                    ? { ran: true, error: prError }
                    : { ran: true },
              prs: prData,
              prErrors,
            }),
          );
        }
        renderCompare(rows, left, right, prData);
      },
    );
}
