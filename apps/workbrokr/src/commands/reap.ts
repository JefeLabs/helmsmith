import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { reapLeases } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerReap(program: Command): void {
  program
    .command('reap')
    .description(
      'Expire idle leases: stop only what they started, release them, park their efforts',
    )
    .option('--dry-run', 'list what would be reaped without touching anything')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(async (o: { dryRun?: boolean; projectRoot?: string; json?: boolean }) => {
      try {
        const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
        const r = await reapLeases(ctx, { dryRun: o.dryRun });
        if (o.json) printJson(r);
        else if (r.reaped.length === 0) console.log(chalk.gray('nothing to reap'));
        else
          for (const l of r.reaped)
            console.log(
              `${o.dryRun ? 'would reap' : 'reaped'} ${l.kind} ${l.value} (${l.owner.session}, expired ${l.expires})`,
            );
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
