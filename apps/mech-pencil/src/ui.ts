/** Tiny chalk wrappers so command output is consistent across verbs. */

import chalk from 'chalk';

export const heading = (s: string): string => chalk.bold.cyan(s);
export const dim = (s: string): string => chalk.dim(s);
export const ok = (s: string): string => `${chalk.green('✓')} ${s}`;
export const warn = (s: string): string => `${chalk.yellow('!')} ${s}`;
export const err = (s: string): string => `${chalk.red('✗')} ${s}`;
export const bullet = (s: string): string => `${chalk.dim('•')} ${s}`;

export function banner(version: string): void {
  console.log(heading('mech-pencil'), dim(`v${version}`));
  console.log(dim('Generate a single-file Pencil .pen (tokens + components + mockups).'));
  console.log('');
  console.log('Commands:');
  console.log(bullet('init           generate one .pen (tokens + components + screens)'));
  console.log(bullet('gen            alias of init (custom file name)'));
  console.log(bullet('list           list frameworks and their atomic catalog'));
  console.log(bullet('validate       structurally validate a .pen file'));
  console.log(bullet('connect        manage connections (TUI)'));
  console.log('');
  console.log(dim('Run `mech-pencil <command> --help` for options.'));
}
