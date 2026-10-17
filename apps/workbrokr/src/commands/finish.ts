import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { finishEffort } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerFinish(program: Command): void {
  program
    .command('finish')
    .description(
      "Stop the effort's runner, release its leases, push its branch; the worktree and branch stay",
    )
    .requiredOption('--area <area>', 'the area whose open effort to finish')
    .option('--park', 'commit uncommitted changes as wip(<area>) instead of refusing')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(async (o: { area: string; park?: boolean; projectRoot?: string; json?: boolean }) => {
      try {
        const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
        const r = await finishEffort(ctx, { area: o.area, park: o.park });
        if (o.json) printJson(r);
        else {
          console.log(
            `${chalk.bold(r.effort.area)} finished: ${r.effort.branch} pushed${r.parked ? ' (uncommitted changes parked as wip)' : ''}`,
          );
          if (r.notices) console.log(`  ${r.notices} area(s) told about commons changes`);
        }
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
