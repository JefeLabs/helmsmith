import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { StorybrokrError, toErrorBody } from '../../lib/errors.js';
import { findHostRoot } from '../../lib/host.js';
import type { InstanceRecord } from '../../types.js';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const STATUS_COLOR: Record<InstanceRecord['status'], (s: string) => string> = {
  starting: chalk.yellow,
  ready: chalk.green,
  failed: chalk.red,
  stopped: chalk.gray,
};

export function printInstanceTable(records: InstanceRecord[]): void {
  if (records.length === 0) {
    console.log(chalk.gray('no instances'));
    return;
  }
  const rows = records.map((r) => [
    r.id,
    STATUS_COLOR[r.status](r.status.padEnd(8)),
    String(r.port),
    r.component,
    chalk.gray(r.hostRoot),
  ]);
  const widths = [12, 8, 5, Math.max(...rows.map((r) => r[3].length))];
  console.log(
    chalk.bold(
      [
        'ID'.padEnd(widths[0]),
        'STATUS'.padEnd(widths[1]),
        'PORT'.padEnd(widths[2]),
        'COMPONENT'.padEnd(widths[3]),
        'HOST',
      ].join('  '),
    ),
  );
  for (const r of rows)
    console.log(
      [r[0].padEnd(widths[0]), r[1], r[2].padEnd(widths[2]), r[3].padEnd(widths[3]), r[4]].join(
        '  ',
      ),
    );
}

export function printInstance(r: InstanceRecord): void {
  console.log(`${chalk.bold(r.id)}  ${STATUS_COLOR[r.status](r.status)}  ${r.framework}`);
  console.log(`  url        ${chalk.cyan(r.url)}`);
  console.log(`  component  ${r.component}  (${r.hostRoot})`);
  console.log(`  stories    ${r.stories.length} from ${r.storyFiles.length} files`);
  for (const s of r.stories) console.log(`    ${s.id.padEnd(48)} ${chalk.gray(s.iframeUrl)}`);
  if (r.error) {
    console.log(chalk.red(`  error      ${r.error.code}: ${r.error.message}`));
    for (const line of r.error.logTail ?? []) console.log(chalk.gray(`    ${line}`));
  }
}

export function fail(err: unknown, json: boolean): never {
  const body = toErrorBody(err);
  if (json) console.error(JSON.stringify(body));
  else {
    console.error(chalk.red(`${body.code}: ${body.message}`));
    for (const line of body.logTail ?? []) console.error(chalk.gray(`  ${line}`));
  }
  process.exit(1);
}

/** User path (absolute, cwd-relative, or host-relative) → host root + host-relative component. */
export function resolveComponent(pathArg: string): { component: string; hostRoot: string } {
  const abs = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const start = existsSync(abs) ? abs : dirname(abs);
  const hostRoot = findHostRoot(start);
  if (!hostRoot)
    throw new StorybrokrError('HOST_NOT_FOUND', `no .storybook/ directory above ${abs}`);
  return { component: relative(hostRoot, abs).split('\\').join('/'), hostRoot };
}
