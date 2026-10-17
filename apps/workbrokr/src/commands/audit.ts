import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { auditProject } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerAudit(program: Command): void {
  program
    .command('audit')
    .description(
      'List what would otherwise be forgotten: unsaved work, stray checkouts, aging leases, drift, stale notices',
    )
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the findings as JSON')
    .action(async (o: { projectRoot?: string; json?: boolean }) => {
      try {
        const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: true });
        const findings = await auditProject(ctx);
        if (o.json) printJson(findings);
        else if (findings.length === 0) console.log(chalk.green('nothing forgotten'));
        else
          for (const f of findings)
            console.log(
              `${chalk.yellow(f.kind.padEnd(14))} ${f.area ? `${f.area}  ` : ''}${f.detail}`,
            );
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
