import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { promoteEffort } from '../lib/effort.js';
import { fail, printJson, warn } from './_shared/output.js';

export function registerPromote(program: Command): void {
  program
    .command('promote')
    .description('Promote an open effort in place to backend or fullstack mode')
    .requiredOption('--area <area>', 'the area of the open effort')
    .option('--task <slug>', 'intra-area task slug if promoting a task sub-effort')
    .requiredOption('--mode <mode>', 'target mode: backend | fullstack')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(
      async (o: {
        area: string;
        task?: string;
        mode: 'backend' | 'fullstack';
        projectRoot?: string;
        json?: boolean;
      }) => {
        try {
          const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
          const r = await promoteEffort(ctx, {
            area: o.area,
            task: o.task,
            mode: o.mode,
          });
          if (o.json) printJson(r);
          else {
            const label = r.effort.task ? `${r.effort.area}--${r.effort.task}` : r.effort.area;
            console.log(
              `${chalk.bold(label)} promoted to ${r.effort.mode}${r.startedServices.length ? ` (started: ${r.startedServices.join(', ')})` : ''}`,
            );
            for (const w of r.warnings) warn(w);
          }
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
