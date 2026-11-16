import chalk from 'chalk';
import ora from 'ora';
import { type CommitMessage, generateCommitMessages, type TicketContext } from '../ai.js';
import { categorize, mergeCategories, UNKNOWN_CATEGORY } from '../categorizer.js';
import { type Config, loadConfig } from '../config.js';
import { createGit, type GitOps } from '../git.js';
import { VERSION } from '../version.js';
import { TRAILER_LINE } from './_shared/attribution.js';
import {
  applySubjectOverrides,
  isCommitScope,
  isCommitType,
  retypeForBranch,
  styleHasTypes,
} from './_shared/conventional.js';
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
  /** Scope of every commit: one to three lowercase segments (`network`, `org/global`). */
  scope?: string;
  /** Type of the code commits; test and storybook commits keep theirs. */
  type?: string;
  /** `Token: value` lines added to every commit after the configured `commitTrailers`. */
  trailer?: string[];
}

export interface CommitOutcome {
  dryRun: boolean;
  commits: Array<{
    change?: string;
    category: string;
    message: string;
    files: string[];
    sha?: string;
  }>;
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

/** How a commit is named in prompts and progress lines: its change too, when it has one. */
function label(c: CommitMessage): string {
  return c.change ? `${c.change} · ${c.category}` : c.category;
}

/** Refuse a bad --type, --scope or --trailer before anything else runs: no model call, no commit. */
function validateOverrides(options: CommitOptions, style: Config['commitStyle']): void {
  if ((options.type !== undefined || options.scope !== undefined) && !styleHasTypes(style)) {
    throw new Error(
      `--type and --scope need a commit style with \`type(scope):\` subjects (conventional or angular), not ${style}`,
    );
  }
  if (options.type !== undefined && !isCommitType(options.type)) {
    throw new Error(
      `--type ${options.type} is not a conventional type: feat, fix, perf, refactor, revert, build, ci, docs, style, test or chore`,
    );
  }
  if (options.scope !== undefined && !isCommitScope(options.scope)) {
    throw new Error(
      `--scope ${options.scope} must be one to three lowercase segments joined by "/", like network, org/global or org/network/directory`,
    );
  }
  for (const line of options.trailer ?? []) {
    if (!TRAILER_LINE.test(line)) {
      throw new Error(`--trailer "${line}" is not a git trailer: write it as \`Token: value\``);
    }
  }
}

/**
 * Generate AI commit messages per change per category (or per category, with
 * `commitGrouping: "category"`) and commit each group from the index. Resolves ticket context up front so validation gates fail fast
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
  validateOverrides(options, config.commitStyle);
  const trailers = [...config.commitTrailers, ...(options.trailer ?? [])];

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
          commitGrouping: config.commitGrouping,
          categories,
          version: VERSION,
        })
      : null;
  let plan: CommitMessage[] | undefined;
  if (cache && key && !dryRun) {
    const saved = await cache.read(key);
    if (saved) {
      try {
        plan = reconcileCommitPlan(saved, grouped, undefined, config.commitGrouping);
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
        (from, to) => say(chalk.dim(`  the model named the ${to} commit "${from}"; paired them`)),
        config.commitGrouping,
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

  // 3.6 --type and --scope: what the caller knows wins over the model and the branch
  const overridden = applySubjectOverrides(plan, { type: options.type, scope: options.scope });
  plan = overridden.plan;
  for (const category of overridden.kept) {
    say(
      chalk.yellow(
        `  ${category}: kept as written, not a conventional subject, so --type/--scope could not apply`,
      ),
    );
  }

  // 4. Show the plan
  say('');
  say(chalk.cyan('Commit plan:'));
  // Grouped by change, the files are the model's choice: show them under each commit.
  const byChange = plan.some((c) => c.change);
  const pad = byChange ? '    ' : '  ';
  let heading: string | null = null;
  for (const c of plan) {
    const change = c.change ?? 'no change named';
    if (byChange && change !== heading) say(`  ${chalk.cyan(change)}`);
    heading = change;
    say(`${pad}${chalk.bold(c.category)}  ${chalk.dim(`(${c.files.length} files)`)}`);
    say(`${pad}  ${chalk.green(c.message)}`);
    if (c.body) for (const line of c.body.split('\n')) say(`${pad}  ${chalk.dim(line)}`);
    if (byChange) for (const f of c.files) say(`${pad}  ${chalk.dim(f)}`);
  }
  say('');

  // 4.5 Optional per-commit editing — default N so the wrap-up stays fast.
  if (!auto && !dryRun) {
    for (let i = 0; i < plan.length; i++) {
      const c = plan[i]!;
      const wantEdit = await deps.prompts.confirm({
        message: `Edit message for ${label(c)}?`,
        default: false,
      });
      if (!wantEdit) continue;
      const edited = await deps.prompts.editor({
        message: `Editing ${label(c)} commit message`,
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
      commits: plan.map((c) => ({
        ...(c.change ? { change: c.change } : {}),
        category: c.category,
        message: c.message,
        files: c.files,
      })),
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
        composeCommitMessage(c, trailers),
        c.files,
        options.noVerify ? { noVerify: true } : undefined,
      );
    } catch (err) {
      io.err(
        chalk.red(
          `✗ failed to commit ${label(c)}: ${(err as Error).message} (${commits.length} commit(s) already made)`,
        ),
      );
      throw err;
    }
    const sha = await git.headSha();
    commits.push({
      ...(c.change ? { change: c.change } : {}),
      category: c.category,
      message: c.message,
      files: c.files,
      sha,
    });
    say(chalk.green(`✓ committed ${label(c)}: ${c.message} (${sha.slice(0, 7)})`));
  }
  say(chalk.green(`\n✓ ${commits.length} commit(s) created.`));
  if (cache && key) await cache.clear().catch(() => undefined);
  return finish({ dryRun: false, commits, ...(reused ? { reusedPlan: true as const } : {}) });
}
