import chalk from 'chalk';
import ora from 'ora';
import { generateRebasePlan, type RebasePlan, type RebaseStep } from '../ai.js';
import { loadConfig } from '../config.js';
import { createGit } from '../git.js';
import { resolveBaseBranch } from './_shared/base.js';
import { colorAction, renderRebaseTodo } from './_shared/format.js';
import { output } from './_shared/output.js';
import { confirm } from './_shared/prompts.js';

export interface RebaseOptions {
  strategy?: string;
  base?: string;
  dryRun?: boolean;
  /**
   * One JSON line (RebaseOutcome) on stdout, everything else on stderr. Does
   * not approve anything: without --dry-run it still asks, so it needs a terminal.
   */
  json?: boolean;
}

export interface RebaseOutcome {
  dryRun: boolean;
  branch: string;
  /** The ref compared against: origin/<base> when the remote has it. */
  base: string;
  strategy: string;
  /** Commits ahead of base, oldest first (the order of steps). */
  commits: Array<{ hash: string; subject: string }>;
  /** Empty when there was nothing to consolidate (fewer than two commits). */
  steps: RebaseStep[];
  summary: string | null;
  /** True only when git rewrote the branch. */
  rebased: boolean;
}

/**
 * AI-planned interactive rebase over commits ahead of base branch.
 * Always requires explicit confirmation — no --auto-approve flag,
 * since rebase rewrites history and gets the friction it deserves.
 */
export async function runRebase(options: RebaseOptions = {}): Promise<void> {
  const { say, result } = output(options.json);
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

  const base = await git.resolveBaseRef(
    resolveBaseBranch({ flag: options.base, config: config.baseBranch }).base,
  );
  const commits = await git.log(base);
  const dryRun = Boolean(options.dryRun);
  const outcome = (o: Pick<RebaseOutcome, 'steps' | 'summary' | 'rebased'>): RebaseOutcome =>
    result({ dryRun, branch, base, strategy, commits: [...commits].reverse(), ...o });
  const nothing = { steps: [], summary: null, rebased: false };
  if (commits.length === 0) {
    say(chalk.dim(`No commits between ${base} and ${branch}. Nothing to rebase.`));
    outcome(nothing);
    return;
  }
  if (commits.length === 1) {
    say(chalk.dim(`Only one commit ahead of ${base} — nothing to consolidate.`));
    outcome(nothing);
    return;
  }

  // The confirmation below cannot be skipped, so without a terminal there is
  // no way to reach it: say so now, before a model call that would be wasted.
  if (!dryRun && !process.stdin.isTTY) {
    console.error(
      chalk.red(
        '✗ pritty rebase always asks before rewriting history, and stdin is not a terminal. Run it in a terminal, or pass --dry-run (with --json for the plan as JSON) to see the plan without touching git.',
      ),
    );
    process.exit(1);
  }

  say(
    chalk.cyan(
      `Rebasing ${commits.length} commit(s) on ${branch} → ${base}  ${chalk.dim(`(strategy: ${strategy})`)}`,
    ),
  );
  for (const c of commits) {
    say(`  ${chalk.dim(c.hash.slice(0, 7))}  ${c.subject}`);
  }
  say('');

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
  say('');
  say(chalk.cyan('Plan (oldest first):'));
  for (const step of plan.steps) {
    const tag = colorAction(step.action);
    const message = step.message ? ` — ${chalk.green(step.message)}` : '';
    const rationale = step.rationale ? ` ${chalk.dim(`(${step.rationale})`)}` : '';
    say(`  ${tag} ${chalk.dim(step.hash.slice(0, 7))}${message}${rationale}`);
  }
  if (plan.summary) {
    say('');
    say(chalk.dim(`Summary: ${plan.summary}`));
  }
  say('');

  const planned = { steps: plan.steps, summary: plan.summary || null };
  if (dryRun) {
    say(chalk.yellow('Dry-run — git not touched. Re-run without --dry-run to execute.'));
    outcome({ ...planned, rebased: false });
    return;
  }

  // Always require explicit confirmation — no --auto-approve for
  // rebase. Destructive operations get the friction they deserve.
  const ok = await confirm(
    {
      message: chalk.yellow(`This will rewrite history on ${branch}. Proceed?`),
      default: false,
    },
    options.json ? { output: process.stderr } : undefined,
  );
  if (!ok) {
    say(chalk.dim('Aborted. No changes made.'));
    outcome({ ...planned, rebased: false });
    return;
  }

  // Execute via GIT_SEQUENCE_EDITOR
  const todoContent = renderRebaseTodo(plan.steps);
  const execSpinner = ora({
    text: `Rebasing on ${base}...`,
    color: 'cyan',
  }).start();
  const rebase = await git.rebaseWithPlan(base, todoContent);
  if (rebase.ok) {
    execSpinner.succeed('Rebase complete');
    outcome({ ...planned, rebased: true });
  } else {
    execSpinner.fail('Rebase failed');
    console.error('');
    console.error(chalk.red(rebase.output));
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
