import chalk from 'chalk';
import type { Command } from 'commander';
import type { Lease } from '../core/index.js';
import { buildCtx } from '../lib/context.js';
import { type StatusReport, statusFor } from '../lib/effort.js';
import { fail, printJson } from './_shared/output.js';

const age = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return mins < 60
    ? `${mins}m`
    : mins < 1440
      ? `${Math.round(mins / 60)}h`
      : `${Math.round(mins / 1440)}d`;
};
const expiresIn = (iso: string) => {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  return mins <= 0 ? chalk.red('expired') : mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
};

export function printStatus(r: StatusReport): void {
  console.log(chalk.bold(`${r.project}`));
  const cols = ['AREA', 'TYPE/MODE', 'BRANCH', 'OWNER', 'STARTED', 'LEASES', 'BEHIND', 'NOTICES'];
  const rows = r.areas.map((a) => [
    a.area,
    a.effort ? `${a.effort.type}/${a.effort.mode}` : chalk.gray('-'),
    a.effort?.branch ?? chalk.gray('-'),
    a.effort?.owner.session ?? chalk.gray('-'),
    a.effort ? age(a.effort.started) : chalk.gray('-'),
    a.leases.length ? a.leases.map((l) => `${l.kind}:${l.value}`).join(',') : chalk.gray('-'),
    a.behindBase > 0 ? chalk.yellow(String(a.behindBase)) : '0',
    a.notices.length ? chalk.yellow(String(a.notices.length)) : '0',
  ]);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips chalk's ANSI colour codes for width math
  const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((row) => plain(row[i]).length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => c + ' '.repeat(widths[i] - plain(c).length)).join('  ');
  console.log(chalk.bold(line(cols)));
  for (const row of rows) console.log(line(row));
  if (r.leases.length) {
    console.log('');
    console.log(chalk.bold('KIND       VALUE        OWNER                 AGE   EXPIRES-IN'));
    for (const l of r.leases as Lease[]) {
      console.log(
        `${l.kind.padEnd(10)} ${String(l.value).padEnd(12)} ${l.owner.session.padEnd(21)} ${age(l.created).padEnd(5)} ${expiresIn(l.expires)}`,
      );
    }
  }
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Open efforts, leases, drift from the base branch and notices, per area')
    .option('--area <area>', 'one area only')
    .option('--project-root <dir>', 'repository root (default: the main checkout of the cwd)')
    .option('--json', 'print the report as JSON')
    .action(async (o: { area?: string; projectRoot?: string; json?: boolean }) => {
      try {
        const ctx = await buildCtx({ projectRoot: o.projectRoot, quiet: true });
        const r = statusFor(ctx, o.area);
        if (o.json) printJson(r);
        else printStatus(r);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
