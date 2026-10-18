import chalk from 'chalk';
import type { RebaseStep } from '../../ai.js';

/** POSIX single-quote: safe for any text, newlines included. */
function shQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render a rebase plan as the TODO file git expects (oldest-first, one action
 * per line). git ignores any text after the hash, so a planned message is
 * applied with `exec git commit --amend -m …` after the step it belongs to:
 * right after a reword, or after the run of squash/fixup steps it closes.
 * Squash is rendered as fixup because the message comes from the plan, not
 * from an editor session; a message on the pick that opens a run names the
 * combined commit when no squash step in the run carries one.
 */
export function renderRebaseTodo(steps: readonly RebaseStep[]): string {
  const lines: string[] = [];
  let runMessage: string | undefined;
  const closeRun = (): void => {
    if (runMessage !== undefined) lines.push(`exec git commit --amend -m ${shQuote(runMessage)}`);
    runMessage = undefined;
  };
  for (const step of steps) {
    switch (step.action) {
      case 'drop':
        closeRun();
        lines.push(`drop ${step.hash}`);
        break;
      case 'pick':
      case 'reword':
        closeRun();
        lines.push(`pick ${step.hash}`);
        runMessage = step.message;
        break;
      case 'squash':
      case 'fixup':
        lines.push(`fixup ${step.hash}`);
        if (step.message) runMessage = step.message;
        break;
    }
  }
  closeRun();
  return `${lines.join('\n')}\n`;
}

/** Color the action verb in the rebase plan preview. */
export function colorAction(action: RebaseStep['action']): string {
  switch (action) {
    case 'pick':
      return chalk.green('pick   ');
    case 'reword':
      return chalk.cyan('reword ');
    case 'squash':
      return chalk.yellow('squash ');
    case 'fixup':
      return chalk.yellow('fixup  ');
    case 'drop':
      return chalk.red('drop   ');
  }
}

/**
 * Parse text from $EDITOR back into { title, body }. Standard
 * conventional-commit / PR format: first line is the subject, blank
 * line(s), then body. Tolerant of users who skip the blank-line rule.
 */
export function splitTitleBody(text: string): { title: string; body: string } {
  const lines = text.split('\n');
  const title = (lines[0] ?? '').trim();
  let i = 1;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const body = lines.slice(i).join('\n').trimEnd();
  return { title, body };
}
