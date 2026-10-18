import { confirm, editor } from '@inquirer/prompts';
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
  type PRResult,
  requestReviewers,
} from '../github.js';
import { findPullRequestTemplate, type PullRequestTemplate } from '../pr-template.js';
import { resolveBaseBranch } from './_shared/base.js';
import { splitTitleBody } from './_shared/format.js';
import { resolveTicketContext } from './_shared/ticket-context.js';

export interface PrOptions {
  base?: string;
  autoApprove?: boolean;
  dryRun?: boolean;
}

export interface PrOutcome {
  number: number;
  url: string;
  /** false when an open PR for this head and base already existed and was returned instead. */
  created: boolean;
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
  ticket: (config: Config, branch: string, git: GitOps) => Promise<TicketContext | undefined>;
  template: () => PullRequestTemplate | null;
  codeowners: () => string | null;
  prompts: {
    confirm(o: { message: string; default?: boolean }): Promise<boolean>;
    editor(o: { message: string; default?: string }): Promise<string>;
  };
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
 * PR cannot be created or already exists; then commits and the AI draft;
 * push and create last. Errors are thrown (the CLI prints them and exits 1).
 */
export async function runPr(
  options: PrOptions = {},
  deps: PrDeps = defaultDeps(),
): Promise<PrOutcome | undefined> {
  const { git, config } = deps;
  const auto = options.autoApprove ?? config.autoApprove;
  const dryRun = options.dryRun ?? config.dryRun;

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
      console.error(
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
  if (baseSource === 'remote') {
    console.log(
      chalk.dim(
        `Base ${effectiveBase} is the repository's default branch; set baseBranch in .pritty.json or pass --base to override.`,
      ),
    );
  }
  console.log(
    chalk.cyan(
      `Repository: ${repo.owner}/${repo.repo}  ${chalk.dim(`(${branch} → ${effectiveBase})`)}`,
    ),
  );

  // 4. An open PR for this head and base already exists: return it, create nothing.
  //    A failed lookup is fatal; pushing without knowing would be worse.
  const open = await deps.github.listOpenPRs(repo.owner, repo.repo, branch, effectiveBase);
  if (open.length > 0) {
    const existing = open[0]!;
    console.log(
      chalk.yellow(
        `An open PR already exists for ${branch} → ${effectiveBase}: #${existing.number}`,
      ),
    );
    console.log(chalk.green(`✓ ${existing.url}`));
    return { number: existing.number, url: existing.url, created: false };
  }

  // 5. Commits since the base (against origin/<base> when the remote has it)
  const baseRef = await git.resolveBaseRef(effectiveBase);
  const commits = await git.log(baseRef);
  if (commits.length === 0) {
    console.log(chalk.dim(`No commits between ${effectiveBase} and ${branch}. Nothing to PR.`));
    return undefined;
  }
  console.log(chalk.cyan(`Commits in PR (${commits.length}):`));
  for (const c of commits) {
    console.log(`  ${chalk.dim(c.hash.slice(0, 7))}  ${c.subject}`);
  }
  console.log('');

  // 6. Ticket context (may prompt), template, AI draft
  const ticketCtx = await deps.ticket(config, branch, git);
  const template = deps.template();
  if (template) {
    console.log(
      chalk.dim(
        `  (using PR template: ${template.path}${template.truncated ? ' — truncated' : ''})`,
      ),
    );
  }

  const spinner = ora({ text: 'Generating PR description...', color: 'cyan' }).start();
  let draft: PRDraft;
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

  // 7. Preview
  console.log('');
  console.log(chalk.bold.cyan(draft.title));
  console.log('');
  for (const line of draft.body.split('\n')) {
    console.log(`  ${chalk.dim(line)}`);
  }
  if (draft.labels.length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Labels: ')}${draft.labels.join(', ')}`);
  }
  console.log('');

  // 7.5 Optional editor pass — default N so the wrap-up stays fast.
  if (!auto && !dryRun) {
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
        console.log(chalk.yellow('⚠ Empty title — keeping original.'));
      } else {
        draft = { ...draft, title: nextTitle, body: nextBody };
      }
    }
  }

  // 8. Dry-run stops here
  if (dryRun) {
    console.log(
      chalk.yellow('Dry-run — no push, no PR created. Re-run without --dry-run to apply.'),
    );
    return undefined;
  }

  // 9. Confirm
  if (!auto) {
    const ok = await deps.prompts.confirm({
      message: `Push ${branch} and open this PR?`,
      default: true,
    });
    if (!ok) {
      console.log(chalk.dim('Aborted.'));
      return undefined;
    }
  }

  // 10. Push (set upstream)
  const pushSpinner = ora({ text: `Pushing ${branch} to origin...`, color: 'cyan' }).start();
  try {
    await git.push(branch, { setUpstream: true });
    pushSpinner.succeed('Pushed');
  } catch (err) {
    pushSpinner.fail((err as Error).message);
    throw err;
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
    });
    prSpinner.succeed(`PR #${result.number} created`);
  } catch (err) {
    prSpinner.fail((err as Error).message);
    throw err;
  }

  // 12. Labels (non-fatal)
  if (draft.labels.length > 0) {
    try {
      await deps.github.addLabels(repo.owner, repo.repo, result.number, draft.labels);
      console.log(chalk.dim(`  Applied labels: ${draft.labels.join(', ')}`));
    } catch (err) {
      console.error(chalk.yellow(`⚠ Couldn't apply labels: ${(err as Error).message}`));
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
        console.log(chalk.dim(`  Requested reviewers: ${summary}`));
      } catch (err) {
        console.error(chalk.yellow(`⚠ Couldn't request reviewers: ${(err as Error).message}`));
      }
    }
  }

  console.log('');
  console.log(chalk.green(`✓ ${result.url}`));
  return { number: result.number, url: result.url, created: true };
}
