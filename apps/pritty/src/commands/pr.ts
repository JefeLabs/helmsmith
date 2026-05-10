import { confirm, editor } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { generatePR } from '../ai.js';
import { findCodeowners, parseCodeowners, resolveReviewers } from '../codeowners.js';
import { loadConfig } from '../config.js';
import { createGit, parseGitHubRemote } from '../git.js';
import {
  addLabels,
  createPR,
  getDefaultBranch,
  listOpenPRsForHead,
  requestReviewers,
} from '../github.js';
import { findPullRequestTemplate } from '../pr-template.js';
import { splitTitleBody } from './_shared/format.js';
import { resolveTicketContext } from './_shared/ticket-context.js';

export interface PrOptions {
  base?: string;
  autoApprove?: boolean;
  dryRun?: boolean;
}

/**
 * Generate a pull request title + body via AI and open it on GitHub.
 * Auto-detects base branch, PR template, and CODEOWNERS reviewers.
 */
export async function runPr(options: PrOptions = {}): Promise<void> {
  const config = loadConfig();
  const git = createGit();

  // 1. Resolve branch + remote → owner/repo
  const branch = await git.getCurrentBranch();
  const ticketCtx = await resolveTicketContext(config, branch, git);
  const remoteUrl = await git.getRemoteUrl();
  if (!remoteUrl) {
    console.error(
      chalk.red('✗ No `origin` remote configured. Add one with `git remote add origin ...`.'),
    );
    process.exit(1);
  }
  const repo = parseGitHubRemote(remoteUrl);
  if (!repo) {
    console.error(chalk.red(`✗ Remote URL doesn't look like GitHub: ${remoteUrl}`));
    process.exit(1);
  }

  const base = options.base ?? config.baseBranch;
  // If config.baseBranch is the schema default ("main") but the
  // repo's actual default branch differs, prefer the GitHub-side
  // default. Saves users from accidental wrong-base PRs.
  let effectiveBase = base;
  try {
    const defaultBranch = await getDefaultBranch(repo.owner, repo.repo);
    if (!options.base && defaultBranch !== base) {
      console.log(
        chalk.dim(
          `Note: repo's default branch is ${defaultBranch}, config's baseBranch is ${base}. Using ${defaultBranch}. Pass --base to override.`,
        ),
      );
      effectiveBase = defaultBranch;
    }
  } catch (err) {
    console.error(chalk.yellow(`⚠ Couldn't query repo default branch: ${(err as Error).message}`));
  }

  console.log(
    chalk.cyan(
      `Repository: ${repo.owner}/${repo.repo}  ${chalk.dim(`(${branch} → ${effectiveBase})`)}`,
    ),
  );

  // 2. Warn about existing open PRs from this branch
  try {
    const open = await listOpenPRsForHead(repo.owner, repo.repo, branch);
    if (open.length > 0) {
      console.log(chalk.yellow(`⚠ ${open.length} open PR(s) already exist for ${branch}:`));
      for (const pr of open) {
        console.log(`    ${chalk.dim(`#${pr.number}`)} ${pr.title} — ${pr.url}`);
      }
    }
  } catch (err) {
    console.error(chalk.yellow(`⚠ Couldn't list existing PRs: ${(err as Error).message}`));
  }

  // 3. Get commits between base and HEAD
  const commits = await git.log(effectiveBase);
  if (commits.length === 0) {
    console.log(chalk.dim(`No commits between ${effectiveBase} and ${branch}. Nothing to PR.`));
    return;
  }
  console.log(chalk.cyan(`Commits in PR (${commits.length}):`));
  for (const c of commits) {
    console.log(`  ${chalk.dim(c.hash.slice(0, 7))}  ${c.subject}`);
  }
  console.log('');

  // 4. AI-generate title + body + labels.
  const template = findPullRequestTemplate();
  if (template) {
    console.log(
      chalk.dim(
        `  (using PR template: ${template.path}${template.truncated ? ' — truncated' : ''})`,
      ),
    );
  }

  const spinner = ora({
    text: 'Generating PR description...',
    color: 'cyan',
  }).start();
  // biome-ignore lint/suspicious/noImplicitAnyLet: assigned in try/catch below
  let draft;
  try {
    draft = await generatePR(
      commits,
      { branch, base: effectiveBase, owner: repo.owner, repo: repo.repo },
      config,
      ticketCtx,
      template,
    );
    spinner.succeed('PR description ready');
  } catch (err) {
    spinner.fail((err as Error).message);
    process.exit(1);
  }

  // 5. Show preview
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

  // 5.5. Optional editor pass — default N so the wrap-up stays fast.
  if (!options.autoApprove && !options.dryRun) {
    const wantEdit = await confirm({
      message: 'Edit PR title or body?',
      default: false,
    });
    if (wantEdit) {
      const combined = `${draft.title}\n\n${draft.body}`;
      const edited = await editor({
        message: 'Editing PR (first line = title, blank line, then body)',
        default: combined,
      });
      const { title: nextTitle, body: nextBody } = splitTitleBody(edited);
      if (nextTitle.length === 0) {
        console.log(chalk.yellow('⚠ Empty title — keeping original.'));
      } else {
        draft = { ...draft, title: nextTitle, body: nextBody };
      }
    }
  }

  // 6. Dry-run exits here
  if (options.dryRun) {
    console.log(
      chalk.yellow('Dry-run — no push, no PR created. Re-run without --dry-run to apply.'),
    );
    return;
  }

  // 7. Confirm
  if (!options.autoApprove) {
    const ok = await confirm({
      message: `Push ${branch} and open this PR?`,
      default: true,
    });
    if (!ok) {
      console.log(chalk.dim('Aborted.'));
      return;
    }
  }

  // 8. Push (set upstream — assume first push for the branch)
  const pushSpinner = ora({
    text: `Pushing ${branch} to origin...`,
    color: 'cyan',
  }).start();
  try {
    await git.push(branch, { setUpstream: true });
    pushSpinner.succeed('Pushed');
  } catch (err) {
    pushSpinner.fail((err as Error).message);
    process.exit(1);
  }

  // 9. Create PR
  const prSpinner = ora({ text: 'Creating PR...', color: 'cyan' }).start();
  // biome-ignore lint/suspicious/noImplicitAnyLet: assigned in try/catch below
  let result;
  try {
    result = await createPR({
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
    process.exit(1);
  }

  // 10. Apply labels (optional, non-fatal on failure)
  if (draft.labels.length > 0) {
    try {
      await addLabels(repo.owner, repo.repo, result.number, draft.labels);
      console.log(chalk.dim(`  Applied labels: ${draft.labels.join(', ')}`));
    } catch (err) {
      console.error(chalk.yellow(`⚠ Couldn't apply labels: ${(err as Error).message}`));
    }
  }

  // 11. Auto-request reviewers from CODEOWNERS, if present
  const codeownersContent = findCodeowners();
  if (codeownersContent) {
    const rules = parseCodeowners(codeownersContent);
    const changedFiles = await git.changedFilesBetween(effectiveBase);
    const reviewers = resolveReviewers(changedFiles, rules);
    if (reviewers.users.length > 0 || reviewers.teams.length > 0) {
      try {
        await requestReviewers(
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
}
