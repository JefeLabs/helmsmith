/**
 * `gitradar --reset` end to end (#96): recovers from a corrupt DB without opening it,
 * never destroys data without `--yes` off a terminal, and a fresh install says to scan.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

describe('gitradar --reset', () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await createSandbox();
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('on a fresh install says there is no data and to run scan, exit 1', async () => {
    const r = await runCli(sb, ['--reset', '--yes']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/no data/i);
    expect(r.stdout).toMatch(/gitradar scan/);
  });

  it('without --yes and no terminal, refuses and leaves the file alone', async () => {
    const dataDir = join(sb.gitradarHome, 'data');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'gitradar.db'), 'not a database\n');
    const r = await runCli(sb, ['--reset']);
    expect(r.exitCode).toBe(1);
    expect(await readFile(join(dataDir, 'gitradar.db'), 'utf-8')).toBe('not a database\n');
  });

  it('with --yes moves a corrupt DB aside and the next command works', async () => {
    const dataDir = join(sb.gitradarHome, 'data');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'gitradar.db'), 'not a database\n');

    const before = await runCli(sb, ['--store-stats']);
    expect(before.exitCode).toBe(1);
    expect(before.stderr).toMatch(/corrupt/i);

    const reset = await runCli(sb, ['--reset', '--yes']);
    expect(reset.exitCode).toBe(0);
    expect(reset.stderr).toBe('');
    const files = await readdir(dataDir);
    expect(files.some((f) => /^gitradar\.db\.bak-/.test(f))).toBe(true);
    expect(files).not.toContain('gitradar.db');

    const after = await runCli(sb, ['--store-stats']);
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toMatch(/Records:\s+0/);
  });

  it('--store-stats on a fresh install creates the data dir instead of advising --reset', async () => {
    const r = await runCli(sb, ['--store-stats']);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/Records:\s+0/);
  });
});
