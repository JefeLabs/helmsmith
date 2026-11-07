import chalk from 'chalk';
import type { Command } from 'commander';
import { CliCache } from '../core/index.js';
import type { CacheClearDocument, CachePruneDocument } from '../output/contract.js';
import { emitJson } from '../output/json.js';

export function registerCache(program: Command): void {
  const cacheCmd = program.command('cache').description('Manage result cache');

  cacheCmd
    .command('clear')
    .description('Clear all cached results')
    .option('--json', 'Print { cleared } as one JSON line')
    .action(async (opts: { json?: boolean }) => {
      const c = new CliCache();
      const cleared = c.clear();
      if (opts.json) return emitJson({ cleared } satisfies CacheClearDocument);
      console.log(chalk.green(`✓ Cleared ${cleared} cached result(s)`));
    });

  cacheCmd
    .command('prune')
    .description('Remove expired cache entries')
    .option('--json', 'Print { pruned } as one JSON line')
    .action(async (opts: { json?: boolean }) => {
      const c = new CliCache();
      const pruned = c.prune();
      if (opts.json) return emitJson({ pruned } satisfies CachePruneDocument);
      console.log(chalk.green(`✓ Pruned ${pruned} expired entry/entries`));
    });
}
