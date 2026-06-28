import chalk from 'chalk';
import type { RebaseStep } from '../../ai.js';

/**
 * Render a rebase plan as the TODO file git expects (oldest-first,
 * one action per line). When a step has a message and the action
 * permits one (reword / squash / pick — git ignores it on fixup /
 * drop), append it after the hash so the rebase TODO carries the
 * intended subject.
 */
export function renderRebaseTodo(steps: readonly RebaseStep[]): string {
  const lines: string[] = [];
  for (const step of steps) {
    if (step.action === 'drop') {
      lines.push(`drop ${step.hash}`);
      continue;
    }
    const trail = step.message ? ` ${step.message}` : '';
    lines.push(`${step.action} ${step.hash}${trail}`);
  }
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
