import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { finishEffort } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerFinish(program: Command): void {
  program
    .command('finish')
    .description(
      "Stop the effort's runner, release its leases, push its branch (or merge --into-area); area worktrees stay, task worktrees are cleaned up",
    )
    .requiredOption('--area <area>', 'the area whose open effort to finish')
    .option('--task <slug>', 'finish an intra-area task sub-effort')
    .option('--park', 'commit uncommitted changes as wip(<area>) instead of refusing')
    .option('--into-area', 'merge task branch into <type>/<area> instead of pushing to origin')
    .option('--force', 'stop and finish even if other joined participants remain')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(
      async (o: {
        area: string;
        task?: string;
        park?: boolean;
        intoArea?: boolean;
        force?: boolean;
        projectRoot?: string;
        json?: boolean;
      }) => {
        try {
          const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
          const r = await finishEffort(ctx, {
            area: o.area,
            task: o.task,
            park: o.park,
            intoArea: o.intoArea,
            force: o.force,
          });
          if (o.json) printJson(r);
          else {
            const label = r.effort.task ? `${r.effort.area}--${r.effort.task}` : r.effort.area;
            if (r.left) {
              console.log(`${chalk.bold(label)}: left shared effort (other participants remain)`);
            } else if (r.mergedIntoArea) {
              console.log(
                `${chalk.bold(label)} finished: ${r.effort.branch} merged into ${r.effort.type}/${r.effort.area}`,
              );
            } else {
              console.log(
                `${chalk.bold(label)} finished: ${r.effort.branch} pushed${r.parked ? ' (uncommitted changes parked as wip)' : ''}`,
              );
            }
            if (r.notices) console.log(`  ${r.notices} area(s) told about commons changes`);
          }
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
