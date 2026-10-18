import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import { generatePR, type PRDraft, type TicketContext } from '../ai.js';
import { findCodeowners, parseCodeowners, resolveReviewers } from '../codeowners.js';
import { type Config, loadConfig } from '../config.js';
import { createGit, describeRemote, type GitOps, parseGitHubRemote } from '../git.js';
import {
  addLabels,
  assertGitHubToken,
  type CreatePROptions,
  createPR,
  getDefaultBranch,
  listOpenPRs,
  type OpenPRSummary,
  type PRPatch,
  type PRResult,
  requestReviewers,
  updatePR,
} from '../github.js';
import { findPullRequestTemplate, type PullRequestTemplate } from '../pr-template.js';
import { applyFooter } from './_shared/attribution.js';
import { resolveBaseBranch } from './_shared/base.js';
import { splitTitleBody } from './_shared/format.js';
import { inferLabels } from './_shared/labels.js';
import { confirm, editor } from './_shared/prompts.js';
import { resolveTicketContext, type TicketContextOptions } from './_shared/ticket-context.js';

export interface PrOptions {
  base?: string;
  autoApprove?: boolean;
  dryRun?: boolean;
  /** One JSON line on stdout, everything else on stderr; implies autoApprove. */
  json?: boolean;
  /** Open the PR as a draft. */
  draft?: boolean;
  /** Use this title verbatim: no model, no ticket flow. */
  title?: string;
  /** Use this body verbatim (with --title). */
  body?: string;
  /** Read the body from this file (with --title). */
  bodyFile?: string;
  /** The caller already pushed the branch with upstream tracking. */
  noPush?: boolean;
}

export interface PrOutcome {
  number: number;
  url: string;
  /** false when an open PR for this head and base already existed and was returned instead. */
  created: boolean;
  draft: boolean;
  head: string;
  base: string;
}

/** Everything `runPr` touches outside its own logic, so tests can assert the order of operations. */
export interface PrDeps {
  git: GitOps;
  config: Config;
  github: {
    assertToken(): Promise<void>;
    getDefaultBranch(owner: string, repo: string): Promise<string>;
    listOpenPRs(owner: string, repo: string, head: string, base?: string): Promise<OpenPRSummary[]>;
    createPR(o: CreatePROptions): Promise<PRResult>;
    updatePR(owner: string, repo: string, n: number, patch: PRPatch): Promise<void>;
    addLabels(owner: string, repo: string, n: number, labels: readonly string[]): Promise<void>;
    requestReviewers(
      owner: string,
      repo: string,
      n: number,
      users: readonly string[],
      teams: readonly string[],
    ): Promise<void>;
  };
  ai: { generatePR: typeof generatePR };
  ticket: (
    config: Config,
    branch: string,
    git: GitOps,
    opts?: TicketContextOptions,
  ) => Promise<TicketContext | undefined>;
  template: () => PullRequestTemplate | null;
  codeowners: () => string | null;
  prompts: {
    confirm(o: { message: string; default?: boolean }): Promise<boolean>;
    editor(o: { message: string; default?: string }): Promise<string>;
  };
  /** Where human output goes; under --json everything but the JSON line goes to err. */
  io?: { out: (line: string) => void; err: (line: string) => void };
}

function defaultDeps(): PrDeps {
  return {
    git: createGit(),
    config: loadConfig(),
    github: {
      assertToken: assertGitHubToken,
      getDefaultBranch,
      listOpenPRs,
      createPR,
      updatePR,
      addLabels,
      requestReviewers,
    },
    ai: { generatePR },
    ticket: resolveTicketContext,
    template: findPullRequestTemplate,
    codeowners: findCodeowners,
    prompts: { confirm, editor },
  };
}

/**
 * Open a pull request for the current branch. Order matters: the token and
 * the open-PR check come first, so nothing is generated or pushed when the
 * PR cannot be created or already exists; then commits and the words (given
 * verbatim, or drafted by the model); push and create last. Errors are
 * thrown (the CLI prints them and exits 1).
 */
export async function runPr(
  options: PrOptions = {},
  deps: PrDeps = defaultDeps(),
): Promise<PrOutcome | undefined> {
  const { git, config } = deps;
  const io = deps.io ?? {
    out: (l: string) => console.log(l),
    err: (l: string) => console.error(l),
  };
  const say = options.json ? io.err : io.out;
  const auto = Boolean(options.json) || (options.autoApprove ?? config.autoApprove);
  const dryRun = options.dryRun ?? config.dryRun;
  const finish = (o: PrOutcome): PrOutcome => {
    if (options.json) io.out(JSON.stringify(o));
    return o;
  };
  const given = resolveGivenText(options);

  // 1. Branch + remote → owner/repo
  const branch = await git.getCurrentBranch();
  if (!branch || branch === 'HEAD' || /^[0-9a-f]{7,40}$/.test(branch)) {
    throw new Error('Not on a branch (detached HEAD). Check out a branch before opening a PR.');
  }
  const remoteUrl = await git.getRemoteUrl();
  if (!remoteUrl) {
    throw new Error('No `origin` remote configured. Add one with `git remote add origin ...`.');
  }
  const repo = parseGitHubRemote(remoteUrl);
  if (!repo) {
    throw new Error(
      `The \`origin\` remote is not a GitHub URL pritty understands: ${describeRemote(remoteUrl)}`,
    );
  }

  // 2. Token first: a missing or unusable one must fail before any push.
  await deps.github.assertToken();

  // 3. Base: --base, else an explicit config value, else the repository's default
  //    branch (queried only when neither is set), else main.
  let remoteDefault: string | undefined;
  if (!options.base && !config.baseBranch) {
    try {
      remoteDefault = await deps.github.getDefaultBranch(repo.owner, repo.repo);
    } catch (err) {
      io.err(
        chalk.yellow(
          `⚠ Couldn't query the repository's default branch (${(err as Error).message}); assuming main. Pass --base or set baseBranch in .pritty.json.`,
        ),
      );
    }
  }
  const { base: effectiveBase, source: baseSource } = resolveBaseBranch({
    flag: options.base,
    config: config.baseBranch,
    remoteDefault,
  });
  if (options.json && baseSource !== 'flag' && baseSource !== 'config') {
    throw new Error(
      '--json needs --base <branch> (or baseBranch in .pritty.json) so an unattended run never inherits the repository default branch.',
    );
  }
  if (baseSource === 'remote') {
    say(
      chalk.dim(
        `Base ${effectiveBase} is the repository's default branch; set baseBranch in .pritty.json or pass --base to override.`,
      ),
    );
  }
  say(
    chalk.cyan(
      `Repository: ${repo.owner}/${repo.repo}  ${chalk.dim(`(${branch} → ${effectiveBase})`)}`,
    ),
  );

  // 4. An open PR for this head and base already exists: return it (updating its
  //    title/body when they were given explicitly), create nothing. A failed
  //    lookup is fatal; pushing without knowing would be worse.
  const open = await deps.github.listOpenPRs(repo.owner, repo.repo, branch, effectiveBase);
  if (open.length > 0) {
    const existing = open[0]!;
    say(
      chalk.yellow(
        `An open PR already exists for ${branch} → ${effectiveBase}: #${existing.number}`,
      ),
    );
    if (given) {
      const patch: PRPatch = {
        ...(given.title !== undefined ? { title: given.title } : {}),
        ...(given.body !== undefined ? { body: applyFooter(given.body, config.prFooter) } : {}),
      };
      await deps.github.updatePR(repo.owner, repo.repo, existing.number, patch);
      say(chalk.dim('  Updated its title/body in place.'));
    }
    say(chalk.green(`✓ ${existing.url}`));
    return finish({
      number: existing.number,
      url: existing.url,
      created: false,
      draft: existing.draft,
      head: branch,
      base: effectiveBase,
    });
  }

  // 5. Commits since the base (against origin/<base> when the remote has it)
  const baseRef = await git.resolveBaseRef(effectiveBase);
  const commits = await git.log(baseRef);
  if (commits.length === 0) {
    say(chalk.dim(`No commits between ${effectiveBase} and ${branch}. Nothing to PR.`));
    return undefined;
  }
  say(chalk.cyan(`Commits in PR (${commits.length}):`));
  for (const c of commits) {
    say(`  ${chalk.dim(c.hash.slice(0, 7))}  ${c.subject}`);
  }
  say('');

  // 6. The words: given verbatim (no model, no ticket flow), or drafted by the model
  let draft: PRDraft;
  if (given) {
    draft = { title: given.title ?? '', body: given.body ?? '', labels: inferLabels(commits) };
    if (draft.title.length === 0) {
      throw new Error('--title is required when --body/--body-file is given.');
    }
  } else {
    const ticketCtx = await deps.ticket(config, branch, git, { interactive: !auto });
    const template = deps.template();
    if (template) {
      say(
        chalk.dim(
          `  (using PR template: ${template.path}${template.truncated ? ' — truncated' : ''})`,
        ),
      );
    }
    const spinner = ora({ text: 'Generating PR description...', color: 'cyan' }).start();
    try {
      draft = await deps.ai.generatePR(
        commits,
        { branch, base: effectiveBase, owner: repo.owner, repo: repo.repo },
        config,
        ticketCtx,
        template,
      );
      spinner.succeed('PR description ready');
    } catch (err) {
      spinner.fail((err as Error).message);
      throw err;
    }
  }

  draft = { ...draft, body: applyFooter(draft.body, config.prFooter) };

  // 7. Preview
  say('');
  say(chalk.bold.cyan(draft.title));
  say('');
  for (const line of draft.body.split('\n')) {
    say(`  ${chalk.dim(line)}`);
  }
  if (draft.labels.length > 0) {
    say('');
    say(`  ${chalk.dim('Labels: ')}${draft.labels.join(', ')}`);
  }
  say('');

  // 7.5 Optional editor pass on the model's draft — default N so the wrap-up stays fast.
  if (!auto && !dryRun && !given) {
    const wantEdit = await deps.prompts.confirm({
      message: 'Edit PR title or body?',
      default: false,
    });
    if (wantEdit) {
      const edited = await deps.prompts.editor({
        message: 'Editing PR (first line = title, blank line, then body)',
        default: `${draft.title}\n\n${draft.body}`,
      });
      const { title: nextTitle, body: nextBody } = splitTitleBody(edited);
      if (nextTitle.length === 0) {
        say(chalk.yellow('⚠ Empty title — keeping original.'));
      } else {
        draft = { ...draft, title: nextTitle, body: applyFooter(nextBody, config.prFooter) };
      }
    }
  }

  // 8. Dry-run stops here
  if (dryRun) {
    say(chalk.yellow('Dry-run — no push, no PR created. Re-run without --dry-run to apply.'));
    return undefined;
  }

  // 9. Confirm
  if (!auto) {
    const ok = await deps.prompts.confirm({
      message: `Push ${branch} and open this PR?`,
      default: true,
    });
    if (!ok) {
      say(chalk.dim('Aborted.'));
      return undefined;
    }
  }

  // 10. Push (set upstream), unless the caller already did
  if (options.noPush) {
    say(chalk.dim(`  (--no-push: assuming ${branch} is already on origin)`));
  } else {
    const pushSpinner = ora({ text: `Pushing ${branch} to origin...`, color: 'cyan' }).start();
    try {
      await git.push(branch, { setUpstream: true });
      pushSpinner.succeed('Pushed');
    } catch (err) {
      pushSpinner.fail((err as Error).message);
      throw err;
    }
  }

  // 11. Create PR
  const prSpinner = ora({ text: 'Creating PR...', color: 'cyan' }).start();
  let result: PRResult;
  try {
    result = await deps.github.createPR({
      owner: repo.owner,
      repo: repo.repo,
      head: branch,
      base: effectiveBase,
      title: draft.title,
      body: draft.body,
      ...(options.draft ? { draft: true } : {}),
    });
    prSpinner.succeed(`${options.draft ? 'Draft PR' : 'PR'} #${result.number} created`);
  } catch (err) {
    prSpinner.fail((err as Error).message);
    throw err;
  }

  // 12. Labels (non-fatal)
  if (draft.labels.length > 0) {
    try {
      await deps.github.addLabels(repo.owner, repo.repo, result.number, draft.labels);
      say(chalk.dim(`  Applied labels: ${draft.labels.join(', ')}`));
    } catch (err) {
      io.err(chalk.yellow(`⚠ Couldn't apply labels: ${(err as Error).message}`));
    }
  }

  // 13. Reviewers from CODEOWNERS (non-fatal)
  const codeownersContent = deps.codeowners();
  if (codeownersContent) {
    const rules = parseCodeowners(codeownersContent);
    const changedFiles = await git.changedFilesBetween(baseRef);
    const reviewers = resolveReviewers(changedFiles, rules);
    if (reviewers.users.length > 0 || reviewers.teams.length > 0) {
      try {
        await deps.github.requestReviewers(
          repo.owner,
          repo.repo,
          result.number,
          reviewers.users,
          reviewers.teams,
        );
        const summary = [
          ...reviewers.users.map((u) => `@${u}`),
          ...reviewers.teams.map((t) => `@${repo.owner}/${t}`),
        ].join(', ');
        say(chalk.dim(`  Requested reviewers: ${summary}`));
      } catch (err) {
        io.err(chalk.yellow(`⚠ Couldn't request reviewers: ${(err as Error).message}`));
      }
    }
  }

  say('');
  say(chalk.green(`✓ ${result.url}`));
  return finish({
    number: result.number,
    url: result.url,
    created: true,
    draft: result.draft,
    head: branch,
    base: effectiveBase,
  });
}

/** `--title` / `--body` / `--body-file` as given; null when none was passed. */
function resolveGivenText(o: PrOptions): { title?: string; body?: string } | null {
  if (o.title === undefined && o.body === undefined && o.bodyFile === undefined) return null;
  if (o.body !== undefined && o.bodyFile !== undefined) {
    throw new Error('Pass --body or --body-file, not both.');
  }
  const body = o.bodyFile !== undefined ? readFileSync(o.bodyFile, 'utf8') : o.body;
  return {
    ...(o.title !== undefined ? { title: o.title } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}
