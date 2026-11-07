import chalk from 'chalk';
import ora from 'ora';
import { type CommitMessage, generateCommitMessages, type TicketContext } from '../ai.js';
import { categorize, mergeCategories, UNKNOWN_CATEGORY } from '../categorizer.js';
import { type Config, loadConfig } from '../config.js';
import { createGit, type GitOps } from '../git.js';
import { VERSION } from '../version.js';
import { retypeForBranch } from './_shared/conventional.js';
import { splitTitleBody } from './_shared/format.js';
import { composeCommitMessage, reconcileCommitPlan } from './_shared/plan.js';
import { filePlanCache, type PlanCache, planKey } from './_shared/plan-cache.js';
import { confirm, editor } from './_shared/prompts.js';
import { resolveTicketContext, type TicketContextOptions } from './_shared/ticket-context.js';

export interface CommitOptions {
  autoApprove?: boolean;
  dryRun?: boolean;
  commitStyle?: string;
  /** One JSON line on stdout, everything else on stderr; implies autoApprove. */
  json?: boolean;
  /** Pass `--no-verify` to every `git commit` (skips the pre-commit and commit-msg hooks). */
  noVerify?: boolean;
}

export interface CommitOutcome {
  dryRun: boolean;
  commits: Array<{ category: string; message: string; files: string[]; sha?: string }>;
  /** Present when the plan came from the previous run (a dry run, or a refused commit), not a new model call. */
  reusedPlan?: true;
}

/** Everything `runCommit` touches outside its own logic, so tests can drive it without git or a model. */
export interface CommitDeps {
  git: GitOps;
  config: Config;
  ai: { generateCommitMessages: typeof generateCommitMessages };
  ticket: (
    config: Config,
    branch: string,
    git: GitOps,
    opts?: TicketContextOptions,
  ) => Promise<TicketContext | undefined>;
  prompts: {
    confirm(o: { message: string; default?: boolean }): Promise<boolean>;
    editor(o: { message: string; default?: string }): Promise<string>;
  };
  io?: { out: (line: string) => void; err: (line: string) => void };
  /** Where a shown plan waits for the run that commits it; without one, every run asks the model. */
  planCache?: PlanCache;
}

/** The plan file lives in the worktree's git directory: untracked, one per index. */
export const PLAN_CACHE_FILE = 'pritty/commit-plan.json';

function defaultDeps(): CommitDeps {
  const git = createGit();
  return {
    git,
    config: loadConfig(),
    ai: { generateCommitMessages },
    ticket: resolveTicketContext,
    prompts: { confirm, editor },
    planCache: filePlanCache(() => git.gitPath(PLAN_CACHE_FILE)),
  };
}

const VALID_STYLES = ['conventional', 'gitmoji', 'angular', 'simple'] as const;

/**
 * Generate AI commit messages per category and commit each group from the
 * index. Resolves ticket context up front so validation gates fail fast
 * (before any AI call). Errors are thrown (the CLI prints them and exits 1).
 */
export async function runCommit(
  options: CommitOptions = {},
  deps: CommitDeps = defaultDeps(),
): Promise<CommitOutcome | undefined> {
  const { git } = deps;
  const config = { ...deps.config };
  const io = deps.io ?? {
    out: (l: string) => console.log(l),
    err: (l: string) => console.error(l),
  };
  const say = options.json ? io.err : io.out;
  const auto = Boolean(options.json) || (options.autoApprove ?? config.autoApprove);
  const dryRun = options.dryRun ?? config.dryRun;
  const finish = (o: CommitOutcome): CommitOutcome => {
    if (options.json) io.out(JSON.stringify(o));
    return o;
  };
  if (options.commitStyle) {
    if (!(VALID_STYLES as readonly string[]).includes(options.commitStyle)) {
      throw new Error(`Invalid --commit-style. Valid: ${VALID_STYLES.join(', ')}`);
    }
    config.commitStyle = options.commitStyle as Config['commitStyle'];
  }

  // Ticket context first: the validation gate fires before any AI call.
  const branch = await git.getCurrentBranch();
  const ticketCtx = await deps.ticket(config, branch, git, { interactive: !auto });

  // 1. Staged files
  const staged = await git.getStaged();
  if (staged.length === 0) {
    say(chalk.dim('No staged files. Stage what you want to commit with `git add` first.'));
    return finish({ dryRun, commits: [] });
  }

  // 2. Categorize
  const categories = mergeCategories(config.categories);
  const grouped = categorize(staged, categories);
  const nonEmpty = Object.entries(grouped).filter(([, files]) => files.length > 0);
  say(chalk.cyan(`Staged files (${staged.length}) — by category:`));
  for (const [name, files] of nonEmpty) {
    const tag = name === UNKNOWN_CATEGORY ? chalk.yellow(name) : chalk.green(name);
    say(`  ${tag} ${chalk.dim(`(${files.length})`)}`);
    for (const f of files) say(`    ${chalk.dim(f)}`);
  }
  say('');

  // 3. Messages: the plan the last run showed for exactly this HEAD and index
  //    (a dry run, or a run whose commit was refused), else the model's. A dry
  //    run always asks the model, so a fresh draft is one dry run away. Files
  //    and order come from the categorizer either way.
  const cache = deps.planCache;
  const stagedState = cache ? await git.stagedState() : null;
  const key =
    cache && stagedState
      ? planKey({
          stagedState,
          branch,
          commitStyle: config.commitStyle,
          categories,
          version: VERSION,
        })
      : null;
  let plan: CommitMessage[] | undefined;
  if (cache && key && !dryRun) {
    const saved = await cache.read(key);
    if (saved) {
      try {
        plan = reconcileCommitPlan(saved, grouped);
        say(
          chalk.dim('Reusing the plan the last run showed: HEAD and the staged changes match it.'),
        );
      } catch {
        plan = undefined;
      }
    }
  }
  const reused = plan !== undefined;
  if (!plan) {
    const spinner = ora({ text: 'Generating commit messages...', color: 'cyan' }).start();
    try {
      const diff = await git.getStagedDiff();
      plan = reconcileCommitPlan(
        await deps.ai.generateCommitMessages(grouped, diff, config, ticketCtx, { branch }),
        grouped,
      );
      spinner.succeed(`Generated ${plan.length} commit message(s)`);
    } catch (err) {
      spinner.fail((err as Error).message);
      throw err;
    }
  }

  // 3.5 On a fix/ branch the code commit is a fix, whatever the diff made the model say
  const typed = retypeForBranch(plan, branch, config.commitStyle);
  plan = typed.plan;
  for (const r of typed.retyped) {
    say(
      chalk.dim(
        `  ${r.category}: typed fix for ${branch} (the model said ${r.from.split(':')[0]})`,
      ),
    );
  }

  // 4. Show the plan
  say('');
  say(chalk.cyan('Commit plan:'));
  for (const c of plan) {
    say(`  ${chalk.bold(c.category)}  ${chalk.dim(`(${c.files.length} files)`)}`);
    say(`    ${chalk.green(c.message)}`);
    if (c.body) for (const line of c.body.split('\n')) say(`    ${chalk.dim(line)}`);
  }
  say('');

  // 4.5 Optional per-commit editing — default N so the wrap-up stays fast.
  if (!auto && !dryRun) {
    for (let i = 0; i < plan.length; i++) {
      const c = plan[i]!;
      const wantEdit = await deps.prompts.confirm({
        message: `Edit message for ${c.category}?`,
        default: false,
      });
      if (!wantEdit) continue;
      const edited = await deps.prompts.editor({
        message: `Editing ${c.category} commit message`,
        default: c.body ? `${c.message}\n\n${c.body}` : c.message,
      });
      const { title: nextMessage, body: nextBody } = splitTitleBody(edited);
      if (nextMessage.length === 0) {
        say(chalk.yellow('⚠ Empty message — keeping original.'));
        continue;
      }
      plan[i] = { ...c, message: nextMessage, body: nextBody.length > 0 ? nextBody : undefined };
    }
  }

  // 4.6 Keep the plan as shown (and edited) for the run that commits it
  if (cache && key) {
    try {
      await cache.write(key, plan);
    } catch (err) {
      io.err(
        chalk.yellow(
          `⚠ Couldn't keep this plan for the next run (${(err as Error).message}); it will ask the model again.`,
        ),
      );
    }
  }

  // 5. Dry-run stops here
  if (dryRun) {
    say(chalk.yellow('Dry-run — no commits made. Re-run without --dry-run to apply.'));
    return finish({
      dryRun: true,
      commits: plan.map((c) => ({ category: c.category, message: c.message, files: c.files })),
    });
  }

  // 6. Confirm
  if (!auto) {
    const ok = await deps.prompts.confirm({
      message: `Create ${plan.length} commit(s) above?`,
      default: true,
    });
    if (!ok) {
      say(chalk.dim('Aborted. No commits made.'));
      return undefined;
    }
  }

  // 7. One commit per group, from the index
  const commits: CommitOutcome['commits'] = [];
  for (const c of plan) {
    try {
      await git.commit(
        composeCommitMessage(c, config.commitTrailers),
        c.files,
        options.noVerify ? { noVerify: true } : undefined,
      );
    } catch (err) {
      io.err(
        chalk.red(
          `✗ failed to commit ${c.category}: ${(err as Error).message} (${commits.length} commit(s) already made)`,
        ),
      );
      throw err;
    }
    const sha = await git.headSha();
    commits.push({ category: c.category, message: c.message, files: c.files, sha });
    say(chalk.green(`✓ committed ${c.category}: ${c.message} (${sha.slice(0, 7)})`));
  }
  say(chalk.green(`\n✓ ${commits.length} commit(s) created.`));
  if (cache && key) await cache.clear().catch(() => undefined);
  return finish({ dryRun: false, commits, ...(reused ? { reusedPlan: true as const } : {}) });
}
