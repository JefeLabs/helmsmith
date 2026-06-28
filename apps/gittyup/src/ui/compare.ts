import chalk from 'chalk';
import ora from 'ora';
import { ManifestManager } from '../config/manifest.js';
import type { BranchSideInfo, CompareRow, PRInfo, RepoConfig } from '../config/schema.js';
import { GitOperations } from '../core/git-operations.js';
import { RepoManager } from '../core/repo-manager.js';

// ─── Terminal Hyperlinks (OSC 8) ────────────────────────────────────

function link(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

function repoLink(repo: RepoConfig, displayName: string): string {
  if (repo.url) {
    const browserUrl = repo.url.replace(/\.git$/, '');
    return link(browserUrl, displayName);
  }
  return displayName;
}

function prLink(pr: PRInfo): string {
  const icon =
    pr.state === 'open'
      ? chalk.yellow('⚠')
      : pr.state === 'merged'
        ? chalk.green('✓')
        : chalk.red('⊘');
  const label = `${icon}#${pr.number}`;
  return pr.url ? link(pr.url, label) : label;
}

// ─── Data Gathering ─────────────────────────────────────────────────

export async function gatherCompareData(
  _manifest: ManifestManager,
  repoManager: RepoManager,
  target: string | undefined,
  leftBranch: string,
  rightBranch: string,
  options: { fetch?: boolean; checkConflicts?: boolean } = {},
): Promise<CompareRow[]> {
  const repos = target ? repoManager.getReposForTarget(target) : repoManager.getAllRepos();
  if (options.fetch) {
    const s = ora('Fetching remotes...').start();
    await repoManager.fetchAll(target);
    s.succeed('Fetched');
  }

  const spinner = ora(
    `Comparing ${leftBranch} vs ${rightBranch} across ${repos.length} repos...`,
  ).start();
  const rows: CompareRow[] = [];

  for (const repo of repos) {
    spinner.text = `Analyzing ${repo.name}...`;
    try {
      const git = repoManager.getGit(repo);
      const leftRef = repo.branches[leftBranch] ?? leftBranch;
      const rightRef = repo.branches[rightBranch] ?? rightBranch;

      const left = await getSideInfo(git, leftRef);
      const right = await getSideInfo(git, rightRef);

      let hasConflicts = false;
      if (options.checkConflicts !== false && left && right) {
        hasConflicts = await checkConflicts(git, rightRef, leftRef);
      }

      rows.push({ repo, hasConflicts, left, right, pr: null });
    } catch (err) {
      rows.push({
        repo,
        hasConflicts: false,
        left: null,
        right: null,
        pr: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.succeed(`Compared ${repos.length} repos`);
  return rows;
}

async function getSideInfo(git: GitOperations, branchRef: string): Promise<BranchSideInfo | null> {
  try {
    const commits = await git.listCommits(branchRef, 1);
    if (commits.length === 0) return null;
    const latest = commits[0];
    const commitDate = new Date(latest.date);
    const sinceDays = Math.floor((Date.now() - commitDate.getTime()) / (1000 * 60 * 60 * 24));
    const allCommits = await git.listCommits(branchRef, 9999);
    return {
      lastCommitDate: commitDate.toISOString().slice(0, 10),
      author: latest.author.substring(0, 7).toUpperCase(),
      sinceDays,
      commitCount: allCommits.length,
    };
  } catch {
    return null;
  }
}

async function checkConflicts(
  git: GitOperations,
  sourceBranch: string,
  targetBranch: string,
): Promise<boolean> {
  try {
    try {
      await git.instance.raw([
        'merge-tree',
        '--write-tree',
        '--no-messages',
        targetBranch,
        sourceBranch,
      ]);
      return false;
    } catch {
      try {
        const revList = await git.instance.raw([
          'rev-list',
          '--left-right',
          '--count',
          `${targetBranch}...${sourceBranch}`,
        ]);
        const [left, right] = revList.trim().split(/\s+/).map(Number);
        return (left ?? 0) > 0 && (right ?? 0) > 0;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}

// ─── Render ─────────────────────────────────────────────────────────

export function renderCompare(
  rows: CompareRow[],
  leftLabel: string,
  rightLabel: string,
  prData?: Map<string, PRInfo>,
): void {
  const withConflicts = rows.filter((r) => r.hasConflicts);
  const noConflicts = rows.filter((r) => !r.hasConflicts);

  if (withConflicts.length > 0) {
    console.log(chalk.red.bold('\n  🔴 WITH CONFLICTS (manual resolution required)\n'));
    renderSection(withConflicts, leftLabel, rightLabel, prData, true);
  }
  if (noConflicts.length > 0) {
    console.log(chalk.green.bold('\n  ✅ NO CONFLICTS (clean merge expected)\n'));
    renderSection(noConflicts, leftLabel, rightLabel, prData, false);
  }

  console.log(
    chalk.dim(
      `\n  Total: ${rows.length} repos │ ${chalk.red(`${withConflicts.length} conflicts`)} │ ${chalk.green(`${noConflicts.length} clean`)}\n`,
    ),
  );
}

function renderSection(
  rows: CompareRow[],
  leftLabel: string,
  rightLabel: string,
  prData?: Map<string, PRInfo>,
  isConflict?: boolean,
): void {
  const header = [
    pad('REPOSITORY', 36),
    pad(leftLabel, 12),
    pad('AUTHOR', 8),
    pad('SINCE', 6),
    pad('COMMITS', 8),
    pad('PR #', 16),
    pad(rightLabel, 12),
    pad('AUTHOR', 8),
    pad('SINCE', 6),
    'COMMITS',
  ].join('');
  console.log(chalk.bold.white(`  ${header}`));
  console.log(
    chalk.dim(
      `  ${'─'.repeat(34)}  ${'─'.repeat(10)}  ${'─'.repeat(6)}  ${'─'.repeat(5)}  ${'─'.repeat(7)}  ${'─'.repeat(14)}  ${'─'.repeat(10)}  ${'─'.repeat(6)}  ${'─'.repeat(5)}  ${'─'.repeat(7)}`,
    ),
  );

  for (const row of rows) {
    if (row.error) {
      console.log(
        `  ${chalk.red('⚠ ')}${chalk.red(pad(row.repo.name, 34))} ${chalk.red(row.error.substring(0, 60))}`,
      );
      continue;
    }

    const indicator = isConflict ? chalk.red('🔴 ') : chalk.green('✅ ');
    const repoName = repoLink(row.repo, chalk.white(row.repo.name));
    const repoCol = pad(repoName, 34, row.repo.name.length);

    const pr = prData?.get(row.repo.name) ?? row.pr;
    let prStr: string;
    let prVisLen: number;
    if (pr) {
      const linked = prLink(pr);
      const dateStr = pr.date ? ` ${pr.date}` : '';
      prStr = `${linked}${dateStr}`;
      prVisLen = `⚠#${pr.number}${dateStr}`.length;
    } else {
      prStr = 'N/A';
      prVisLen = 3;
    }

    const line = [
      indicator,
      repoCol,
      pad(row.left?.lastCommitDate ?? 'N/A', 12),
      pad(row.left?.author ?? 'N/A', 8),
      pad(colorSince(row.left?.sinceDays ?? -1), 6),
      pad(colorCommits(row.left?.commitCount ?? 0), 8),
      pad(prStr, 16, prVisLen),
      pad(row.right?.lastCommitDate ?? 'N/A', 12),
      pad(row.right?.author ?? 'N/A', 8),
      pad(colorSince(row.right?.sinceDays ?? -1), 6),
      colorCommits(row.right?.commitCount ?? 0),
    ].join('');
    console.log(`  ${line}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function pad(str: string, len: number, knownVisLen?: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences (deliberate)
  const ansiSgr = /\x1b\[[0-9;]*m/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: OSC 8 hyperlink termination (deliberate)
  const ansiHyperlink = /\x1b\]8;;[^\x07]*\x07/g;
  const visLen = knownVisLen ?? str.replace(ansiSgr, '').replace(ansiHyperlink, '').length;
  return visLen >= len ? str : str + ' '.repeat(len - visLen);
}

function colorSince(days: number): string {
  if (days < 0) return chalk.dim('N/A');
  const s = `${days}d`;
  return days <= 3 ? chalk.green(s) : days <= 14 ? chalk.yellow(s) : chalk.red(s);
}

function colorCommits(count: number): string {
  if (count === 0) return chalk.dim('0');
  return count < 10
    ? chalk.white(String(count))
    : count < 50
      ? chalk.yellow(String(count))
      : chalk.red(String(count));
}
