import chalk from 'chalk';
import Table from 'cli-table3';
import type { RepoBranchState, RepoState } from '../config/schema.js';

/**
 * The Status column for one branch row of the dashboard.
 *
 * Two states reach this from `getBranchState` that the problem icons don't cover:
 *  - `state.error` set: the branch couldn't be read (e.g. it exists neither locally nor on
 *    the remote). The other fields are placeholders, so no icon below is an observation.
 *    `error` is one line, e.g. "no branch 'develop' locally or at origin/develop".
 *  - `state.local === false` (and no error): the branch exists only as `trackingBranch`,
 *    e.g. `origin/staging` in a fresh clone. Last commit is the remote's; ahead/behind are
 *    unknown (`null`); dirty/conflicts are about the checked-out branch, not this one.
 *
 * Table cells here are ~35 columns wide before cli-table3 pads them, and the repo-level
 * error row truncates its message to 30 characters (see `render`).
 */
export function branchStatusCell(state: RepoBranchState): string {
  // `local === false` on an error row means both refs were checked and neither exists;
  // any other read failure is reported as unreadable rather than guessed to be missing.
  if (state.error) return chalk.red(state.local === false ? '⚠ no such branch' : '⚠ unreadable');
  // Dirty/conflict flags describe the checked-out working tree, not a branch that isn't
  // checked out, so a remote-only row shows only that it is remote-only.
  if (state.local === false) return chalk.cyan('☁ remote only');

  const icons: string[] = [];
  if (state.hasConflicts) icons.push(chalk.red('⚡conflict'));
  if (state.isDirty) icons.push(chalk.yellow('●dirty'));
  if ((state.ahead ?? 0) > 0 && (state.behind ?? 0) > 0) icons.push(chalk.magenta('↕diverged'));
  if (icons.length === 0) icons.push(chalk.green('✓'));
  return icons.join(' ');
}

/**
 * TUI dashboard for displaying branch state across repos.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: namespacing static helpers; refactoring to bare functions is a separate concern
export class Dashboard {
  /** Render full dashboard grouped by repo group. */
  static render(states: RepoState[], options?: { compact?: boolean }): void {
    const compact = options?.compact ?? false;

    console.log(
      chalk.bold.white(
        `\n  GITTYUP DASHBOARD  │  ${states.length} repo(s)  │  ${new Date().toLocaleString()}\n`,
      ),
    );

    const grouped = new Map<string, RepoState[]>();
    for (const s of states) {
      const list = grouped.get(s.group) ?? [];
      list.push(s);
      grouped.set(s.group, list);
    }

    for (const [groupName, repos] of grouped) {
      console.log(chalk.blue.bold(`  ┌─ ${groupName} ─${'─'.repeat(50)}`));

      const table = new Table({
        head: [
          chalk.dim('Repo'),
          chalk.dim('Branch'),
          chalk.dim('↑ Ahead'),
          chalk.dim('↓ Behind'),
          chalk.dim('Status'),
          chalk.dim('Last Commit'),
        ],
        chars: {
          top: '',
          'top-mid': '',
          'top-left': '',
          'top-right': '',
          bottom: '',
          'bottom-mid': '',
          'bottom-left': '',
          'bottom-right': '',
          left: chalk.dim('  │ '),
          'left-mid': '',
          mid: '',
          'mid-mid': '',
          right: '',
          'right-mid': '',
          middle: chalk.dim(' │ '),
        },
        // `head`/`border` empty: no colours from cli-table3 itself (its defaults are red
        // heads and grey borders, applied even when stdout is a pipe); chalk, used for
        // every cell, already switches itself off there.
        style: { 'padding-left': 0, 'padding-right': 1, head: [], border: [] },
      });

      for (const repo of repos) {
        if (repo.error) {
          table.push([
            chalk.red(repo.name),
            chalk.red('ERROR'),
            '-',
            '-',
            chalk.red(`⚠ ${repo.error.substring(0, 30)}`),
            '-',
          ]);
          continue;
        }

        const branchEntries = Object.entries(repo.branches);
        if (compact || branchEntries.length === 0) {
          table.push([
            chalk.white.bold(repo.name),
            chalk.cyan(repo.currentBranch),
            '-',
            '-',
            repo.hasUnresolved ? chalk.red('⚡ CONFLICTS') : chalk.green('✓ ok'),
            '-',
          ]);
        } else {
          for (let i = 0; i < branchEntries.length; i++) {
            const [alias, state] = branchEntries[i];
            const repoCol = i === 0 ? chalk.white.bold(repo.name) : '';
            const branchLabel =
              state.branch === repo.currentBranch
                ? chalk.cyan.bold(`${alias} (${state.branch}) ●`)
                : chalk.dim(`${alias} (${state.branch})`);
            // `–` when there is no tracking ref: unknown is not "in sync" (spec §7).
            const aheadStr =
              state.ahead === null
                ? chalk.dim('–')
                : state.ahead > 0
                  ? chalk.green(`+${state.ahead}`)
                  : chalk.dim('0');
            const behindStr =
              state.behind === null
                ? chalk.dim('–')
                : state.behind > 0
                  ? chalk.red(`-${state.behind}`)
                  : chalk.dim('0');

            table.push([
              repoCol,
              branchLabel,
              aheadStr,
              behindStr,
              branchStatusCell(state),
              // `lastCommit` is a placeholder ('error') when the branch couldn't be read.
              chalk.dim(state.error ? '-' : state.lastCommit),
            ]);
          }
        }
      }

      console.log(table.toString());
      console.log();
    }

    const totalConflicts = states.filter((s) => s.hasUnresolved).length;
    const totalErrors = states.filter((s) => s.error).length;
    const summary: string[] = [];
    if (totalConflicts > 0) summary.push(chalk.red(`${totalConflicts} conflict(s)`));
    if (totalErrors > 0) summary.push(chalk.red(`${totalErrors} error(s)`));
    if (totalConflicts === 0 && totalErrors === 0) summary.push(chalk.green('All clean'));
    console.log(chalk.dim(`  Summary: ${summary.join(' │ ')}\n`));
  }

  /** Render operation results (merge/cherry-pick) as a table. */
  static renderOperationResults(
    results: Array<{ repo: string; status: string; message: string; prUrl?: string }>,
    operation: string,
  ): void {
    console.log(chalk.bold(`\n  ${operation.toUpperCase()} RESULTS\n`));
    const table = new Table({
      style: { head: [], border: [] }, // see render(): chalk alone decides colour
      head: [chalk.dim('Repo'), chalk.dim('Status'), chalk.dim('Details')],
      chars: {
        top: '',
        'top-mid': '',
        'top-left': '',
        'top-right': '',
        bottom: '',
        'bottom-mid': '',
        'bottom-left': '',
        'bottom-right': '',
        left: '  ',
        'left-mid': '',
        mid: '',
        'mid-mid': '',
        right: '',
        'right-mid': '',
        middle: chalk.dim(' │ '),
      },
    });

    for (const r of results) {
      const statusStr =
        r.status === 'success'
          ? chalk.green('✓ Success')
          : r.status === 'conflict'
            ? chalk.yellow('⚡ Conflict')
            : r.status === 'error'
              ? chalk.red('✗ Error')
              : chalk.dim(r.status);
      const details = r.prUrl ? `${r.message} ${chalk.blue(r.prUrl)}` : r.message;
      table.push([chalk.white(r.repo), statusStr, details]);
    }
    console.log(`${table.toString()}\n`);
  }
}
