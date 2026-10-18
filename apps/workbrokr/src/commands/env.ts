import type { Command } from 'commander';
import { WorkkitError } from '../core/index.js';
import { buildCtx } from '../lib/context.js';
import { effortEnv, slotEnv } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerEnv(program: Command): void {
  program
    .command('env')
    .description("The slot-derived variables of an area's open effort, or of a slot number alone")
    .option('--area <area>', 'the area whose open effort to read')
    .option(
      '--slot <n>',
      'compute the variables for this slot from the manifest alone',
      (v: string) => Number(v),
    )
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print as JSON (default: KEY=value lines)')
    .option('--sh', 'print KEY=value lines (the default)')
    .action(async (o: { area?: string; slot?: number; projectRoot?: string; json?: boolean }) => {
      try {
        const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: true });
        let vars: Record<string, string>;
        if (o.area) vars = effortEnv(ctx, o.area);
        else if (o.slot !== undefined && Number.isInteger(o.slot))
          vars = slotEnv(ctx.manifest, o.slot);
        else throw new WorkkitError('EFFORT_NOT_FOUND', 'pass --area <area> or --slot <n>');
        if (o.json) printJson(vars);
        else for (const [k, v] of Object.entries(vars)) console.log(`${k}=${v}`);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
