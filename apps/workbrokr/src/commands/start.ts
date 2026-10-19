import chalk from 'chalk';
import type { Command } from 'commander';
import type { Mode } from '../core/index.js';
import { buildCtx } from '../lib/context.js';
import { type StartResult, startEffort } from '../lib/effort.js';
import { fail, printJson, warn } from './_shared/output.js';

export function printStart(r: StartResult): void {
  const e = r.effort;
  const label = e.task ? `${e.area}--${e.task}` : e.area;
  console.log(
    `${chalk.bold(label)}  ${e.type}/${e.mode}  ${e.branch}${r.joined ? chalk.yellow('  (joined)') : ''}`,
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
      "Start an effort: the area's worktree on <type>/<area> (or <type>/<area>--<task>), synced from the base branch, leased and running",
    )
    .requiredOption('--area <area>', 'a leaf area from helmsmith.config (e.g. org/applications)')
    .option(
      '--task <slug>',
      'intra-area task slug for parallel sub-efforts (<type>/<area>--<slug>)',
    )
    .requiredOption('--type <type>', 'feature | chore | fix (as the manifest allows)')
    .requiredOption('--mode <mode>', 'fullstack | backend (a slot) | frontend (storybrokr)')
    .option('--scope <glob...>', 'narrow exclusive scope globs for this task sub-effort')
    .option(
      '--story <path>',
      'frontend: the story file or component folder storybrokr boots, relative to the Storybook host',
    )
    .option('--join', 'work in the already-open effort on this area instead of refusing')
    .option(
      '--reset-db',
      'fullstack/backend: drop and recreate the slot database before the services start (then seed)',
    )
    .option('--no-sync', 'skip the fetch and merge from the base branch (reproducing something)')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the result as JSON')
    .action(
      async (o: {
        area: string;
        task?: string;
        type: string;
        mode: string;
        scope?: string[];
        story?: string;
        join?: boolean;
        resetDb?: boolean;
        sync: boolean;
        projectRoot?: string;
        json?: boolean;
      }) => {
        try {
          const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: Boolean(o.json) });
          const r = await startEffort(ctx, {
            area: o.area,
            task: o.task,
            type: o.type,
            mode: o.mode as Mode,
            scopes: o.scope,
            story: o.story,
            join: o.join,
            sync: o.sync,
            resetDb: o.resetDb,
          });
          if (o.json) printJson(r);
          else printStart(r);
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
