import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { generateRebasePlan, type RebasePlan } from '../ai.js';
import { loadConfig } from '../config.js';
import { createGit } from '../git.js';
import { colorAction, renderRebaseTodo } from './_shared/format.js';

export interface RebaseOptions {
  strategy?: string;
  base?: string;
  dryRun?: boolean;
}

/**
 * AI-planned interactive rebase over commits ahead of base branch.
 * Always requires explicit confirmation — no --auto-approve flag,
 * since rebase rewrites history and gets the friction it deserves.
 */
export async function runRebase(options: RebaseOptions = {}): Promise<void> {
  const config = loadConfig();
  const git = createGit();

  // Strategy resolution: CLI flag > config > default
  const validStrategies = ['interactive', 'squash', 'fixup', 'auto'] as const;
  const strategy =
    (options.strategy as (typeof validStrategies)[number] | undefined) ?? config.rebaseStrategy;
  if (!validStrategies.includes(strategy)) {
    console.error(
      chalk.red(`✗ Invalid --strategy "${strategy}". Valid: ${validStrategies.join(', ')}`),
    );
    process.exit(1);
  }

  // Preflight: working tree must be clean. Rebase rewrites history;
  // uncommitted work would get caught in the crossfire.
  if (!options.dryRun && !(await git.isWorkingTreeClean())) {
    console.error(
      chalk.red('✗ Working tree not clean. Stash or commit your changes before rebasing.'),
    );
    process.exit(1);
  }

  // Preflight: refuse to rebase shared default-ish branches.
  const branch = await git.getCurrentBranch();
  const protectedBranches = ['main', 'master', 'develop'];
  if (protectedBranches.includes(branch)) {
    console.error(
      chalk.red(
        `✗ Refusing to rebase ${branch} — that's a shared branch. Switch to a feature branch first.`,
      ),
    );
    process.exit(1);
  }

  const base = options.base ?? config.baseBranch;
  const commits = await git.log(base);
  if (commits.length === 0) {
    console.log(chalk.dim(`No commits between ${base} and ${branch}. Nothing to rebase.`));
    return;
  }
  if (commits.length === 1) {
    console.log(chalk.dim(`Only one commit ahead of ${base} — nothing to consolidate.`));
    return;
  }

  console.log(
    chalk.cyan(
      `Rebasing ${commits.length} commit(s) on ${branch} → ${base}  ${chalk.dim(`(strategy: ${strategy})`)}`,
    ),
  );
  for (const c of commits) {
    console.log(`  ${chalk.dim(c.hash.slice(0, 7))}  ${c.subject}`);
  }
  console.log('');

  // Generate plan
  const spinner = ora({ text: 'Generating rebase plan...', color: 'cyan' }).start();
  let plan: RebasePlan;
  try {
    plan = await generateRebasePlan(commits, strategy, config);
    spinner.succeed('Plan ready');
  } catch (err) {
    spinner.fail((err as Error).message);
    process.exit(1);
  }

  // Show plan (oldest-first matches git rebase TODO order)
  console.log('');
  console.log(chalk.cyan('Plan (oldest first):'));
  for (const step of plan.steps) {
    const tag = colorAction(step.action);
    const message = step.message ? ` — ${chalk.green(step.message)}` : '';
    const rationale = step.rationale ? ` ${chalk.dim(`(${step.rationale})`)}` : '';
    console.log(`  ${tag} ${chalk.dim(step.hash.slice(0, 7))}${message}${rationale}`);
  }
  if (plan.summary) {
    console.log('');
    console.log(chalk.dim(`Summary: ${plan.summary}`));
  }
  console.log('');

  if (options.dryRun) {
    console.log(chalk.yellow('Dry-run — git not touched. Re-run without --dry-run to execute.'));
    return;
  }

  // Always require explicit confirmation — no --auto-approve for
  // rebase. Destructive operations get the friction they deserve.
  const ok = await confirm({
    message: chalk.yellow(`This will rewrite history on ${branch}. Proceed?`),
    default: false,
  });
  if (!ok) {
    console.log(chalk.dim('Aborted. No changes made.'));
    return;
  }

  // Execute via GIT_SEQUENCE_EDITOR
  const todoContent = renderRebaseTodo(plan.steps);
  const execSpinner = ora({
    text: `Rebasing on ${base}...`,
    color: 'cyan',
  }).start();
  const result = await git.rebaseWithPlan(base, todoContent);
  if (result.ok) {
    execSpinner.succeed('Rebase complete');
  } else {
    execSpinner.fail('Rebase failed');
    console.error('');
    console.error(chalk.red(result.output));
    console.error('');
    console.error(
      chalk.yellow(
        'Your branch is now in a paused rebase state.\n' +
          '  Resolve conflicts, then `git rebase --continue`\n' +
          '  Or undo entirely:                `git rebase --abort`',
      ),
    );
    process.exit(1);
  }
}
