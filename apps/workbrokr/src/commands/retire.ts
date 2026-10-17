import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { retireArea } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerRetire(program: Command): void {
  program
    .command('retire')
    .description(
      "Archive an area's evidence, remove its worktree and its local branches that are on origin (the only destructive verb)",
    )
    .requiredOption('--area <area>', 'the area to retire')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(async (o: { area: string; projectRoot?: string; json?: boolean }) => {
      try {
        const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
        const r = await retireArea(ctx, { area: o.area });
        if (o.json) printJson(r);
        else {
          console.log(`${chalk.bold(o.area)} retired: removed ${r.removed}`);
          for (const a of r.archived) console.log(`  archived ${a}`);
          for (const b of r.branchesDeleted) console.log(`  deleted local branch ${b}`);
          for (const b of r.branchesKept)
            console.log(chalk.yellow(`  kept ${b}: not fully on origin`));
        }
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
