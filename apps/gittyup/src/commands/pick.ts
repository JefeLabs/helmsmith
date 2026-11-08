import chalk from 'chalk';
import type { Command } from 'commander';
import { ManifestManager } from '../config/manifest.js';
import type { AiMode, CherryPickTarget } from '../config/schema.js';
import { GittyupError } from '../core/errors.js';
import { runPickJson } from '../core/json-operations.js';
import { Orchestrator } from '../core/orchestrator.js';
import { confirmGate } from '../ui/confirm.js';
import {
  emitMergePickReport,
  parseAiFlag,
  refuseSuggest,
  requireScope,
  requireYes,
} from './merge-pick-json.js';

export function registerPick(program: Command): void {
  program
    .command('pick')
    .alias('cherry-pick')
    .description('Cherry-pick commits between branches within repos')
    .option('-g, --group <name>', 'Target group')
    .option('-r, --repo <name>', 'Target single repo')
    .option('-s, --source <branch>', 'Source branch (or alias)')
    .option('-t, --target <branch>', 'Target branch (or alias)')
    .option('-c, --commits <shas...>', 'Specific commit SHAs')
    .option('-i, --interactive', 'Interactively select commits', false)
    .option('--ai <mode>', 'AI mode: auto | suggest | manual')
    .option('--push', 'Push after cherry-pick', false)
    .option('--pr', 'Create PRs', false)
    .option('--no-fetch', 'Skip fetching')
    .option('-y, --yes', 'Skip the AI write confirmation', false)
    .option(
      '--json',
      'Run without prompts; print the merge/pick report as one JSON line (needs --yes)',
    )
    .action(
      async (opts: {
        group?: string;
        repo?: string;
        source?: string;
        target?: string;
        commits?: string[];
        interactive?: boolean;
        ai?: string;
        push?: boolean;
        pr?: boolean;
        fetch?: boolean;
        yes?: boolean;
        json?: boolean;
      }) => {
        const manifest = new ManifestManager();
        const orchestrator = new Orchestrator(manifest);

        if (opts.json) {
          // Refusals in spec §5.1 order; nothing is touched before all of them pass.
          const ai = parseAiFlag(opts.ai);
          const { source, target } = opts;
          if (!source || !target) {
            throw new GittyupError('USAGE', 'Specify --source and --target branches');
          }
          const jsonScope = requireScope(opts);
          refuseSuggest(ai);
          if (opts.interactive) {
            throw new GittyupError(
              'INTERACTIVE_ONLY',
              '--interactive needs a person to choose commits; pass --commits with --json',
            );
          }
          const commits = opts.commits ?? [];
          if (commits.length === 0) {
            throw new GittyupError('INTERACTIVE_ONLY', 'pick --json needs --commits');
          }
          requireYes(opts, 'pick');
          const targets: CherryPickTarget[] = orchestrator.repos
            .getReposForTarget(jsonScope)
            .map((repo) => ({
              repo,
              commits,
              sourceBranch: repo.branches[source] ?? source,
              targetBranch: repo.branches[target] ?? target,
            }));
          return emitMergePickReport({
            operation: 'pick',
            source,
            target,
            manifest,
            orchestrator,
            ai,
            opts,
            run: (deps, runOptions) => runPickJson(targets, deps, runOptions),
          });
        }

        const scope = opts.group ?? opts.repo;
        if (!scope) {
          console.error(chalk.red('Specify --group or --repo'));
          process.exit(1);
        }
        if (!opts.source || !opts.target) {
          console.error(chalk.red('Specify --source and --target branches'));
          process.exit(1);
        }

        const repos = orchestrator.repos.getReposForTarget(scope);
        const targets: CherryPickTarget[] = [];

        for (const repo of repos) {
          const sourceBranch = repo.branches[opts.source!] ?? opts.source!;
          const targetBranch = repo.branches[opts.target!] ?? opts.target!;

          let commits: string[];
          if (opts.commits) {
            commits = opts.commits;
          } else if (opts.interactive) {
            console.log(chalk.bold(`\nSelect commits for ${repo.name}:`));
            commits = await orchestrator.selectCommits(repo, sourceBranch);
            if (commits.length === 0) {
              console.log(chalk.yellow(`  Skipping ${repo.name}`));
              continue;
            }
          } else {
            console.error(chalk.red('Specify --commits or use --interactive'));
            process.exit(1);
          }
          targets.push({ repo, commits, sourceBranch, targetBranch });
        }

        if (targets.length === 0) {
          console.log(chalk.yellow('No targets configured.'));
          return;
        }

        console.log(chalk.bold('\n  Cherry-Pick Plan:'));
        for (const t of targets) {
          console.log(
            chalk.dim(
              `    ${t.repo.name}: ${t.commits.length} commit(s) ${t.sourceBranch} → ${t.targetBranch}`,
            ),
          );
          for (const c of t.commits) console.log(chalk.dim(`      ${c.substring(0, 8)}`));
        }

        const ok = await confirmGate(`Proceed with cherry-pick across ${targets.length} repo(s)?`, {
          yes: opts.yes,
        });
        if (!ok) return;

        const results = await orchestrator.executeCherryPick(targets, {
          aiMode: (opts.ai as AiMode) ?? undefined,
          push: opts.push,
          createPR: opts.pr,
          fetch: opts.fetch,
          yes: opts.yes,
        });
        if (results.some((r) => r.status === 'error' || r.status === 'conflict')) {
          process.exitCode = 1;
        }
      },
    );
}
