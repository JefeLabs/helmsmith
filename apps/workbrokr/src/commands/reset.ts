import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { resetEffort } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerReset(program: Command): void {
  program
    .command('reset')
    .description(
      "Fresh database for an open fullstack/backend effort: stop its app services, run the manifest's postgres reset, start them again, then seed",
    )
    .requiredOption('--area <area>', 'the area of the open effort')
    .option('--task <slug>', 'intra-area task slug if resetting a task sub-effort')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(async (o: { area: string; task?: string; projectRoot?: string; json?: boolean }) => {
      try {
        const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
        const r = await resetEffort(ctx, { area: o.area, task: o.task });
        if (o.json) printJson(r);
        else {
          const label = r.effort.task ? `${r.effort.area}--${r.effort.task}` : r.effort.area;
          console.log(
            `${chalk.bold(label)}: slot ${r.lease.value} database reset${r.seeded ? ' and seeded' : ''}; restarted ${r.restarted.join(', ') || 'nothing'}`,
          );
        }
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
