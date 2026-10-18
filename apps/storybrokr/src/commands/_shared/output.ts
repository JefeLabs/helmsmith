import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { InvalidArgumentError } from 'commander';
import { StorybrokrError, toErrorBody } from '../../lib/errors.js';
import { findHostRoot, realpathOrResolve } from '../../lib/host.js';
import type { InstanceRecord } from '../../types.js';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Commander option parser: a finite number >= 0 (fractions allowed, e.g. `--ttl 0.02`). */
export function parseNonNegativeNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new InvalidArgumentError('must be a non-negative number');
  }
  return n;
}

/** Commander option parser factory: an integer within [min, max]. */
export function parseIntegerInRange(min: number, max: number): (value: string) => number {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new InvalidArgumentError(`must be an integer between ${min} and ${max}`);
    }
    return n;
  };
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
  console.log(
    `  stories    ${r.stories.length} from ${r.storyFiles.length} files (children: ${r.includeChildren ? 'yes' : 'no'})`,
  );
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
  const rawAbs = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const abs = existsSync(rawAbs)
    ? realpathOrResolve(rawAbs)
    : join(realpathOrResolve(dirname(rawAbs)), basename(rawAbs));
  const start = existsSync(abs) ? abs : dirname(abs);
  const hostRoot = findHostRoot(start);
  if (!hostRoot)
    throw new StorybrokrError('HOST_NOT_FOUND', `no .storybook/ directory above ${abs}`);
  return { component: relative(hostRoot, abs).split('\\').join('/'), hostRoot };
}

const ID_RE = /^[0-9a-f]{12}$/;

function normalizeAgainstHost(idOrPath: string, hostDir: string): string {
  const hostRoot = realpathOrResolve(hostDir);
  if (isAbsolute(idOrPath)) {
    const abs = existsSync(idOrPath)
      ? realpathOrResolve(idOrPath)
      : join(realpathOrResolve(dirname(idOrPath)), basename(idOrPath));
    const rel = relative(hostRoot, abs).split('\\').join('/');
    if (rel && !rel.startsWith('..')) return rel.replace(/\/+$/, '');
  }
  return idOrPath.replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Normalize an id-or-path argument for `get`, `down`, `touch`, `check`, `screenshot`, `logs`, `open`.
 * Precedence:
 * 1. 12-hex instance id → pass through unchanged
 * 2. explicit `--host` → authoritative `host`
 * 3. `STORYBROKR_HOST` env → preferred `hint`
 * 4. `process.cwd()` inside a host repo → preferred `hint`
 * 5. bare component string outside any host → unscoped
 */
export function resolveTarget(
  idOrPath: string,
  explicitHost?: string,
): { idOrPath: string; host?: string; hint?: string } {
  const host = explicitHost ? realpathOrResolve(explicitHost) : undefined;
  if (ID_RE.test(idOrPath)) {
    return host ? { idOrPath, host } : { idOrPath };
  }
  if (host) {
    return { idOrPath: normalizeAgainstHost(idOrPath, host), host };
  }
  const envHost = process.env.STORYBROKR_HOST?.trim();
  if (envHost) {
    const hint = realpathOrResolve(envHost);
    return { idOrPath: normalizeAgainstHost(idOrPath, hint), hint };
  }
  try {
    const { component, hostRoot } = resolveComponent(idOrPath);
    if (component && component !== '.' && !component.startsWith('..')) {
      return { idOrPath: component.replace(/\/+$/, ''), hint: hostRoot };
    }
  } catch {
    // Fall through to bare component string when cwd is outside any host repo
  }
  return { idOrPath: idOrPath.replace(/^\.\//, '').replace(/\/+$/, '') };
}
