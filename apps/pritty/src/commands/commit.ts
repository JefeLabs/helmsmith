import chalk from 'chalk';
import ora from 'ora';
import type { ValidationResult } from '../adapters/index.js';
import { type CommitMessage, generateCommitMessages, type TicketContext } from '../ai.js';
import { categorize, mergeCategories, UNKNOWN_CATEGORY } from '../categorizer.js';
import { type Config, loadConfig } from '../config.js';
import { createGit, type GitOps } from '../git.js';
import { readStdin } from '../stdin.js';
import { VERSION } from '../version.js';
import { TRAILER_LINE } from './_shared/attribution.js';
import {
  applySubjectOverrides,
  isCommitScope,
  isCommitType,
  parseConventional,
  retypeForBranch,
  styleHasTypes,
} from './_shared/conventional.js';
import {
  type ExplicitCommit,
  parseCommitInput,
  planExplicit,
  STDIN_HINT,
} from './_shared/explicit.js';
import { splitTitleBody } from './_shared/format.js';
import { labelFromChange, normalizeLabel } from './_shared/label.js';
import {
  applyLabels,
  composeCommitMessage,
  reconcileCommitPlan,
  subjectOf,
} from './_shared/plan.js';
import { filePlanCache, type PlanCache, planKey } from './_shared/plan-cache.js';
import { confirm, editor, input } from './_shared/prompts.js';
import {
  lookupTicket,
  resolveTicketContext,
  type TicketContextOptions,
} from './_shared/ticket-context.js';

export interface CommitOptions {
  autoApprove?: boolean;
  dryRun?: boolean;
  commitStyle?: string;
  /** One JSON line on stdout, everything else on stderr; implies autoApprove. */
  json?: boolean;
  /** Pass `--no-verify` to every `git commit` (skips the pre-commit and commit-msg hooks). */
  noVerify?: boolean;
  /**
   * One to three lowercase segments (`network`, `org/global`): with `message`,
   * the commit's scope; otherwise the scope of every commit the model plans.
   */
  scope?: string;
  /** With `message`, the commit's type; otherwise the type of the code commits (test and storybook keep theirs). */
  type?: string;
  /** `Token: value` lines added to every commit after the configured `commitTrailers`. */
  trailer?: string[];
  /** The label of every commit (normalised, e.g. `abc 1` → `ABC-1`). */
  label?: string;
  /** Selects the args input: the description of the one commit to make, with `type` and `scope`. */
  message?: string;
  /** The body of the `message` commit. */
  body?: string;
  /** Marks the `message` commit a breaking change: `!` after the scope. */
  breaking?: boolean;
  /**
   * `json`: the commits come from a JSON body on stdin, `{ "commits": [...] }`,
   * whose `files` are repository-root paths (the form the outcome prints).
   * Implies autoApprove: stdin is the body, so no prompt can be answered.
   */
  input?: string;
  /** Pathspecs of the staged files the `message` commit takes, from `cwd` like `git add`; default every staged file. */
  paths?: string[];
}

export interface CommitOutcome {
  dryRun: boolean;
  commits: Array<{
    change?: string;
    category: string;
    /** The first line as committed, label included. */
    message: string;
    label?: string;
    type?: string;
    scope?: string;
    /** Present, and true, only for a breaking change (`!` in the subject). */
    breaking?: boolean;
    description?: string;
    /** The message body, when the commit has one: a dry run's output fed back to `--input=json` keeps it. */
    body?: string;
    files: string[];
    sha?: string;
  }>;
  /** Present when the plan came from the previous run (a dry run, or a refused commit), not a new model call. */
  reusedPlan?: true;
}

type OutcomeCommit = CommitOutcome['commits'][number];

/**
 * A planned commit as the outcome reports it: `message` is the subject as
 * committed, the label and body are the plan's own, and the other parts are
 * parsed from the subject when it is conventional.
 */
function entryOf(c: CommitMessage): OutcomeCommit {
  const message = subjectOf(c);
  const p = parseConventional(message);
  const label = c.label || p?.label;
  return {
    ...(c.change ? { change: c.change } : {}),
    category: c.category,
    message,
    ...(label ? { label } : {}),
    ...(p ? { type: p.type } : {}),
    ...(p?.scope ? { scope: p.scope } : {}),
    ...(p?.breaking ? { breaking: true } : {}),
    ...(p ? { description: p.description } : {}),
    ...(c.body ? { body: c.body } : {}),
    files: c.files,
  };
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
    input(o: { message: string; default?: string }): Promise<string>;
  };
  /** Looks a typed ticket up in `ticket.validation`'s tracker (default: lookupTicket). */
  lookupTicket?: (config: Config, ticket: string) => Promise<ValidationResult | null>;
  io?: { out: (line: string) => void; err: (line: string) => void };
  /** Where a shown plan waits for the run that commits it; without one, every run asks the model. */
  planCache?: PlanCache;
  /** The JSON body of `--input=json` (default: all of process.stdin). */
  readStdin?: () => Promise<string>;
  /** A terminal stdin refuses `--input=json` at once (default: process.stdin.isTTY). */
  stdinIsTTY?: boolean;
  /**
   * Where paths after `--` resolve from, as `git add` would (default:
   * process.cwd()). A JSON body's `files` ignore it: they are repository-root paths.
   */
  cwd?: string;
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
    prompts: { confirm, editor, input },
    lookupTicket,
    planCache: filePlanCache(() => git.gitPath(PLAN_CACHE_FILE)),
  };
}

const VALID_STYLES = ['conventional', 'gitmoji', 'angular', 'simple'] as const;

/** How a commit is named in prompts and progress lines: its change too, when it has one. */
function nameOf(c: CommitMessage): string {
  return c.change ? `${c.change} · ${c.category}` : c.category;
}

/** One problem per `--trailer` line that is not `Token: value`. */
function trailerProblems(lines: readonly string[] = []): string[] {
  return lines
    .filter((line) => !TRAILER_LINE.test(line))
    .map((line) => `--trailer "${line}" is not a git trailer: write it as \`Token: value\``);
}

/**
 * Which input the call names: `--message` (args), `--input=json` (a JSON body
 * on stdin) or neither (the model). Every refusal here comes before stdin, git
 * or a model is touched; a terminal stdin is refused rather than waited on.
 */
function chooseInput(options: CommitOptions, stdinIsTTY: boolean): 'args' | 'json' | 'interactive' {
  if (options.input !== undefined && options.input !== 'json') {
    throw new Error('--input must be json');
  }
  const paths = (options.paths?.length ?? 0) > 0;
  if (options.input === 'json') {
    if (options.message !== undefined) throw new Error('pass --message or --input, not both');
    const given = [
      options.label !== undefined && '--label',
      options.type !== undefined && '--type',
      options.scope !== undefined && '--scope',
      options.body !== undefined && '--body',
      options.breaking && '--breaking',
      paths && 'paths after --',
    ].filter((flag): flag is string => typeof flag === 'string');
    if (given.length > 0) {
      throw new Error(
        `--input=json takes each commit's fields from the JSON body; drop ${given.join(', ')}`,
      );
    }
    if (stdinIsTTY) throw new Error(`${STDIN_HINT}; stdin is a terminal, so nothing is piped in`);
    return 'json';
  }
  if (options.message !== undefined) return 'args';
  if (options.body !== undefined) throw new Error('--body needs --message');
  if (options.breaking) throw new Error('--breaking needs --message');
  if (paths) {
    throw new Error('paths after -- need --message: a run without it commits every staged file');
  }
  return 'interactive';
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
  if (options.label !== undefined && !styleHasTypes(style)) {
    throw new Error(
      `--label needs a commit style with \`type(scope):\` subjects (conventional or angular), not ${style}`,
    );
  }
  const [badTrailer] = trailerProblems(options.trailer);
  if (badTrailer) throw new Error(badTrailer);
}

/** `--label`, normalised: a blank one is no label, one outside the grammar is refused. */
function explicitLabel(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const result = normalizeLabel(raw);
  if (!result.ok) throw new Error(`--label: ${result.error}`);
  return result.label;
}

/** What every input shares once the options are read. */
interface Run {
  git: GitOps;
  config: Config;
  io: { out: (line: string) => void; err: (line: string) => void };
  /** Human lines: stdout, or stderr under --json. */
  say: (line: string) => void;
  auto: boolean;
  dryRun: boolean;
  trailers: string[];
  noVerify: boolean;
  /** Prints the outcome as the one JSON line under --json. */
  finish: (o: CommitOutcome) => CommitOutcome;
}

/**
 * The plan as it will be committed: each subject as committed, its body, and,
 * under a heading per change (model) or per label (args and JSON), the files
 * it takes. Explicit commits always list their files: the caller chose them.
 */
function showPlan(plan: readonly CommitMessage[], say: Run['say'], by: 'change' | 'label'): void {
  const groupOf = (c: CommitMessage) => (by === 'change' ? c.change : c.label);
  const grouped = plan.some((c) => groupOf(c));
  const files = grouped || by === 'label';
  const pad = grouped ? '    ' : '  ';
  say('');
  say(chalk.cyan('Commit plan:'));
  let heading: string | null = null;
  for (const c of plan) {
    const group = groupOf(c) ?? (by === 'change' ? 'no change named' : 'no label');
    if (grouped && group !== heading) say(`  ${chalk.cyan(group)}`);
    heading = group;
    say(`${pad}${chalk.bold(c.category)}  ${chalk.dim(`(${c.files.length} files)`)}`);
    say(`${pad}  ${chalk.green(subjectOf(c))}`);
    if (c.body) for (const line of c.body.split('\n')) say(`${pad}  ${chalk.dim(line)}`);
    if (files) for (const f of c.files) say(`${pad}  ${chalk.dim(f)}`);
  }
  say('');
}

/** The run's go-ahead: given under --json or --auto-approve, else asked. */
async function approved(plan: readonly CommitMessage[], run: Run, deps: CommitDeps) {
  if (run.auto) return true;
  const ok = await deps.prompts.confirm({
    message: `Create ${plan.length} commit(s) above?`,
    default: true,
  });
  if (!ok) run.say(chalk.dim('Aborted. No commits made.'));
  return ok;
}

/**
 * One commit per plan entry, in order, each from the index with only its
 * files. A commit git refuses stops the run: stderr names it and the commits
 * already made, and the error is rethrown (exit 1).
 */
async function commitAll(plan: readonly CommitMessage[], run: Run): Promise<OutcomeCommit[]> {
  const commits: OutcomeCommit[] = [];
  for (const c of plan) {
    try {
      await run.git.commit(
        composeCommitMessage(c, run.trailers),
        c.files,
        run.noVerify ? { noVerify: true } : undefined,
      );
    } catch (err) {
      const made = commits.map((m) => `${m.sha} ${m.message}`).join(', ') || 'none';
      run.io.err(
        chalk.red(
          `✗ failed to commit ${subjectOf(c)}: ${(err as Error).message}; already committed: ${made}`,
        ),
      );
      throw err;
    }
    const sha = await run.git.headSha();
    commits.push({ ...entryOf(c), sha });
    run.say(chalk.green(`✓ committed ${nameOf(c)}: ${subjectOf(c)} (${sha.slice(0, 7)})`));
  }
  run.say(chalk.green(`\n✓ ${commits.length} commit(s) created.`));
  return commits;
}

/**
 * `--message` or `--input=json`: the caller's commits, checked together and
 * ordered (label by label, code before tests), then committed as given. No
 * ticket context, model, plan cache, retyping or overrides: pritty adds
 * trailers and normalises the label, nothing else.
 */
async function commitExplicit(
  input: 'args' | 'json',
  options: CommitOptions,
  run: Run,
  deps: CommitDeps,
): Promise<CommitOutcome | undefined> {
  const { git, config } = run;
  if (!styleHasTypes(config.commitStyle)) {
    throw new Error(
      `--message and --input=json write \`type(scope):\` subjects, which need the conventional or angular commit style, not ${config.commitStyle}`,
    );
  }
  const problems = trailerProblems(options.trailer);
  if (input === 'args') {
    if (options.type === undefined) problems.push('--type is required with --message');
    if (options.scope === undefined) problems.push('--scope is required with --message');
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));

  const commits: ExplicitCommit[] =
    input === 'json'
      ? parseCommitInput(await (deps.readStdin ?? readStdin)())
      : [
          {
            ...(options.label !== undefined ? { label: options.label } : {}),
            type: options.type!,
            scope: options.scope!,
            ...(options.breaking ? { breaking: true } : {}),
            description: options.message!,
            ...(options.body !== undefined ? { body: options.body } : {}),
            ...(options.paths?.length ? { paths: options.paths } : {}),
          },
        ];
  const staged = await git.getStaged();
  // Paths after `--` resolve from the current directory, like `git add`; a JSON
  // body's files are repository-root paths, as the outcome prints them, so a
  // dry run's output fed back finds the same files from any directory.
  const specs = [...new Set(commits.flatMap((c) => c.paths ?? []))];
  const matched =
    specs.length === 0
      ? new Map<string, string[]>()
      : input === 'json'
        ? await git.stagedFor(specs)
        : await git.stagedFor(specs, deps.cwd ?? process.cwd());
  const { plan, warnings } = planExplicit(commits, {
    staged,
    matched,
    categories: mergeCategories(config.categories),
    labelsRequired: config.commitLabels,
  });

  showPlan(plan, run.say, 'label');
  for (const w of warnings) run.io.err(chalk.yellow(`⚠ ${w}`));
  if (run.dryRun) {
    run.say(chalk.yellow('Dry-run — no commits made. Re-run without --dry-run to apply.'));
    return run.finish({ dryRun: true, commits: plan.map(entryOf) });
  }
  if (!(await approved(plan, run, deps))) return undefined;
  const made = await commitAll(plan, run);
  // A path the caller left out (the old side of a rename, say) is still staged: say so.
  const left = await git.getStaged();
  if (left.length > 0) {
    run.io.err(chalk.yellow(`⚠ ${left.length} file(s) left staged, not committed:`));
    for (const f of left) run.io.err(`  ${f}`);
  }
  return run.finish({ dryRun: false, commits: made });
}

const LABEL_QUESTION =
  "Label for these commits (Jira ticket or effort name, Enter for the model's names):";

/**
 * The label the person types, normalised; blank leaves the labels to the
 * model's change names. An answer outside the label grammar is explained and
 * asked again.
 */
async function askLabel(run: Run, deps: CommitDeps): Promise<string | undefined> {
  for (;;) {
    const answer = await deps.prompts.input({ message: LABEL_QUESTION });
    if (answer.trim() === '') return undefined;
    const result = normalizeLabel(answer);
    if (result.ok) {
      await checkTicket(result.label, run, deps);
      return result.label;
    }
    run.say(chalk.yellow(`⚠ ${result.error}; try again, or press Enter for the model's names`));
  }
}

/**
 * A typed label shaped like the repository's tickets is looked up when
 * `ticket.validation` is configured. A ticket the tracker does not know is a
 * warning, or refused under `validateStrict`; a tracker that cannot answer
 * leaves the label as typed.
 */
async function checkTicket(label: string, run: Run, deps: CommitDeps): Promise<void> {
  const ticket = run.config.ticket;
  if (!ticket?.validation || !matchesTicket(label, ticket.pattern)) return;
  const tracker = ticket.validation.type;
  let result: ValidationResult | null;
  try {
    result = await (deps.lookupTicket ?? lookupTicket)(run.config, label);
  } catch (err) {
    run.say(chalk.yellow(`⚠ Ticket validation failed: ${(err as Error).message}`));
    result = null;
  }
  if (!result) {
    run.say(chalk.dim(`  (couldn't verify ${label} via ${tracker}; using it anyway)`));
  } else if (!result.exists && ticket.validateStrict) {
    throw new Error(
      `${label} not found in ${tracker}: ${result.error ?? 'ticket missing'}. Set ticket.validateStrict: false to proceed anyway.`,
    );
  } else if (!result.exists) {
    run.say(chalk.yellow(`⚠ ${label} not found in ${tracker}; proceeding anyway.`));
  }
}

/** The whole label matches the configured ticket pattern, ignoring case. */
function matchesTicket(label: string, pattern: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`, 'i').test(label);
  } catch {
    return false;
  }
}

/** The first change the model named: under category grouping, the one name for the run. */
function firstChange(raw: readonly CommitMessage[]): string | undefined {
  return raw
    .map((c) => c.change)
    .find((change): change is string => typeof change === 'string' && change.trim() !== '');
}

/**
 * Commit the index from one of three inputs: `--message` (one commit from the
 * flags), `--input=json` (the commits of a JSON body on stdin) or neither,
 * where the model writes a message per change per category (or per category,
 * with `commitGrouping: "category"`). The model path resolves ticket context
 * up front so validation gates fail fast (before any AI call). Where
 * `commitLabels` is on (conventional and angular styles), every commit gets a
 * label: `--label`, else the detected ticket, else the one the person types
 * when asked, else the model's change name; elsewhere only `--label` labels
 * them. Errors are thrown (the CLI prints them and exits 1).
 */
export async function runCommit(
  options: CommitOptions = {},
  deps: CommitDeps = defaultDeps(),
): Promise<CommitOutcome | undefined> {
  const input = chooseInput(options, deps.stdinIsTTY ?? Boolean(process.stdin.isTTY));
  const { git } = deps;
  const config = { ...deps.config };
  const io = deps.io ?? {
    out: (l: string) => console.log(l),
    err: (l: string) => console.error(l),
  };
  const say = options.json ? io.err : io.out;
  // Unattended under --json, and under --input=json, where stdin is the body, not a person.
  const auto =
    Boolean(options.json) || input === 'json' || (options.autoApprove ?? config.autoApprove);
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
  const trailers = [...config.commitTrailers, ...(options.trailer ?? [])];
  const run: Run = {
    git,
    config,
    io,
    say,
    auto,
    dryRun,
    trailers,
    noVerify: Boolean(options.noVerify),
    finish,
  };
  if (input !== 'interactive') return commitExplicit(input, options, run, deps);
  validateOverrides(options, config.commitStyle);
  const explicit = explicitLabel(options.label);
  const labelsOn = config.commitLabels && styleHasTypes(config.commitStyle);

  // Ticket context first: the validation gate fires before any AI call.
  const branch = await git.getCurrentBranch();
  const ticketCtx = await deps.ticket(config, branch, git, { interactive: !auto });
  const detected = labelsOn && ticketCtx?.ticket ? normalizeLabel(ticketCtx.ticket) : undefined;
  const ticketLabel = detected?.ok ? detected.label : undefined;

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
          commitLabels: config.commitLabels,
          label: explicit ?? null,
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
  let chosen: string | undefined;
  let runLabel: string | undefined;
  if (!plan) {
    // Asked before the model, so a refused ticket costs no model call; a kept
    // plan already carries the labels it was shown with.
    if (labelsOn && !explicit && !ticketLabel && !auto) chosen = await askLabel(run, deps);
    const named = explicit ?? chosen ?? ticketLabel;
    const spinner = ora({ text: 'Generating commit messages...', color: 'cyan' }).start();
    try {
      const diff = await git.getStagedDiff();
      // pritty labels commits, never the model: a `label` key in its answer is
      // dropped. Only a kept plan (the one a run showed) carries labels.
      const raw = (
        await deps.ai.generateCommitMessages(grouped, diff, config, ticketCtx, {
          branch,
          labels: labelsOn && !named,
        })
      ).map(({ label: _ignored, ...c }) => c);
      // Read before reconciling, which drops `change` under category grouping.
      if (labelsOn) runLabel = labelFromChange(firstChange(raw));
      plan = reconcileCommitPlan(
        raw,
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

  // 3.7 Labels: --label, the answer, the ticket, then the model's change names;
  //     with commitLabels off, only --label. A commit that has a label keeps it.
  if (labelsOn) plan = applyLabels(plan, { explicit, chosen, ticket: ticketLabel, runLabel });
  else if (explicit) plan = applyLabels(plan, { explicit });

  // 4. Show the plan; grouped by change, the files are the model's choice, so they are listed
  showPlan(plan, say, 'change');

  // 4.5 Optional per-commit editing — default N so the wrap-up stays fast.
  if (!auto && !dryRun) {
    for (let i = 0; i < plan.length; i++) {
      const c = plan[i]!;
      const wantEdit = await deps.prompts.confirm({
        message: `Edit message for ${nameOf(c)}?`,
        default: false,
      });
      if (!wantEdit) continue;
      const edited = await deps.prompts.editor({
        message: `Editing ${nameOf(c)} commit message`,
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
    return finish({ dryRun: true, commits: plan.map(entryOf) });
  }

  // 6. Confirm
  if (!(await approved(plan, run, deps))) return undefined;

  // 7. One commit per group, from the index
  const commits = await commitAll(plan, run);
  if (cache && key) await cache.clear().catch(() => undefined);
  return finish({ dryRun: false, commits, ...(reused ? { reusedPlan: true as const } : {}) });
}
