import { exitCodeFor, toErrorBody } from '@helmsmith/workkit';
import chalk from 'chalk';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Print a failure the way every surface agrees on, then exit 2 (refused) or 1 (broken). */
export function fail(err: unknown, json: boolean): never {
  const body = toErrorBody(err);
  if (json) console.error(JSON.stringify(body));
  else {
    console.error(chalk.red(`${body.code}: ${body.message}`));
    if (body.details) console.error(chalk.gray(`  ${JSON.stringify(body.details)}`));
  }
  process.exit(exitCodeFor(body.code));
}

export function warn(line: string): void {
  console.error(chalk.yellow(`! ${line}`));
}
