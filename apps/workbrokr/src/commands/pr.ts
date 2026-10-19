import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { prEffort } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

export function registerPr(program: Command): void {
  program
    .command('pr [area]')
    .description(
      "Open the effort's pull request through pritty (push first, reuse an open PR, store it on the effort). No area: the effort of the cwd's worktree.",
    )
    .option('--task <slug>', 'intra-area task slug')
    .option('--draft', 'open a draft PR')
    .option('--title <title>', 'PR title (with --body or --body-file: no AI involved)')
    .option('--body <text>', 'PR body text')
    .option('--body-file <path>', 'PR body from a file')
    .option('--force', 'open a new PR when the stored one was merged or closed')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(
      async (
        area: string | undefined,
        o: {
          task?: string;
          draft?: boolean;
          title?: string;
          body?: string;
          bodyFile?: string;
          force?: boolean;
          projectRoot?: string;
          json?: boolean;
        },
      ) => {
        try {
          const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
          const r = await prEffort(ctx, {
            area,
            task: o.task,
            cwd: process.cwd(),
            draft: o.draft,
            title: o.title,
            body: o.body,
            bodyFile: o.bodyFile,
            force: o.force,
          });
          if (o.json) printJson(r);
          else {
            for (const w of r.warnings) console.error(chalk.yellow(w));
            console.log(
              `${r.created ? 'opened' : 'open'} PR #${r.pr.number}${r.pr.draft ? ' (draft)' : ''} for ${r.effort.branch}: ${r.pr.url}`,
            );
          }
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
