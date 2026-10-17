import type { Mode } from '@helmsmith/workkit';
import chalk from 'chalk';
import type { Command } from 'commander';
import { buildCtx } from '../lib/context.js';
import { type StartResult, startEffort } from '../lib/effort.js';
import { fail, printJson, warn } from './_shared/output.js';

export function printStart(r: StartResult): void {
  const e = r.effort;
  console.log(
    `${chalk.bold(e.area)}  ${e.type}/${e.mode}  ${e.branch}${r.joined ? chalk.yellow('  (joined)') : ''}`,
  );
  console.log(`  worktree  ${e.worktree}`);
  console.log(
    `  sync      ${r.sync}${r.refreshed.length ? `  refreshed: ${r.refreshed.join('; ')}` : ''}`,
  );
  for (const l of r.leases) {
    const ports = l.ports
      ? `  ${Object.entries(l.ports)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`
      : '';
    console.log(`  lease     ${l.kind} ${l.value}${ports}  expires ${l.expires}`);
  }
  for (const w of r.warnings) warn(w);
  for (const n of r.notices) console.log(chalk.yellow(`  notice    ${n.text} (${n.at})`));
}

export function registerStart(program: Command): void {
  program
    .command('start')
    .description(
      "Start an effort: the area's worktree on <type>/<area>, synced from the base branch, leased and running",
    )
    .requiredOption('--area <area>', 'a leaf area from helmsmith.config (e.g. org/applications)')
    .requiredOption('--type <type>', 'feature | chore | fix (as the manifest allows)')
    .requiredOption('--mode <mode>', 'fullstack (a slot) | frontend (storybrokr)')
    .option(
      '--story <path>',
      'frontend: the story file or component folder storybrokr boots, relative to the Storybook host',
    )
    .option('--join', 'work in the already-open effort on this area instead of refusing')
    .option('--no-sync', 'skip the fetch and merge from the base branch (reproducing something)')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(
      async (o: {
        area: string;
        type: string;
        mode: string;
        story?: string;
        join?: boolean;
        sync: boolean;
        projectRoot?: string;
        json?: boolean;
      }) => {
        try {
          const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
          const r = await startEffort(ctx, {
            area: o.area,
            type: o.type,
            mode: o.mode as Mode,
            story: o.story,
            join: o.join,
            sync: o.sync,
          });
          if (o.json) printJson(r);
          else printStart(r);
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
