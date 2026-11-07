import chalk from 'chalk';
import type { Command } from 'commander';
import { ManifestManager } from '../config/manifest.js';
import { Orchestrator } from '../core/orchestrator.js';
import { type FetchDocument, toFetchRows } from '../output/contract.js';
import { emitJson } from '../output/json.js';

export function registerFetch(program: Command): void {
  program
    .command('fetch')
    .description('Fetch all remotes across repos')
    .option('-g, --group <name>', 'Filter by group')
    .option('--json', 'Print { repos: [{ repo, ok, error? }] } as one JSON line')
    .action(async (opts: { group?: string; json?: boolean }) => {
      const manifest = new ManifestManager();
      const orchestrator = new Orchestrator(manifest);
      const results = await orchestrator.repos.fetchAll(
        opts.group,
        opts.json
          ? undefined
          : (repo, status) => {
              console.log(chalk.dim(`  ${repo}: ${status}`));
            },
      );
      const failed = results.filter((r) => !r.success);
      // A failed fetch must fail the command, not just warn (G5/C2/C8).
      if (failed.length > 0) process.exitCode = 1;
      if (opts.json) return emitJson({ repos: toFetchRows(results) } satisfies FetchDocument);
      console.log(
        failed.length === 0
          ? chalk.green(`\n✓ Fetched ${results.length} repos`)
          : chalk.yellow(`\n⚠ ${failed.length}/${results.length} failed`),
      );
    });
}
