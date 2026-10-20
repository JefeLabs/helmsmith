/**
 * A planted `<file>.bak` symlink must not make gitradar overwrite its target when it
 * takes a backup before rewriting repos.yml or config.yml.
 */
import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

describe('backups never follow a planted symlink', () => {
  let sb: Sandbox;
  let victim: string;
  beforeEach(async () => {
    sb = await createSandbox();
    victim = join(sb.home, 'precious.txt');
    await writeFile(victim, 'keep me\n');
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('repos.yml: `workspace create` leaves the symlink target alone', async () => {
    const dir = join(sb.home, '.agentx');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'repos.yml'), 'workspaces:\n  a:\n    repos: []\n');
    await symlink(victim, join(dir, 'repos.yml.bak'));

    const r = await runCli(sb, ['workspace', 'create', 'b']);
    expect(r.exitCode).toBe(0);
    expect(await readFile(victim, 'utf-8')).toBe('keep me\n');
    expect((await lstat(join(dir, 'repos.yml.bak'))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(dir, 'repos.yml'), 'utf-8')).toMatch(/\bb:/);
  });

  it('config.yml: `org add` leaves the symlink target alone', async () => {
    await mkdir(sb.gitradarHome, { recursive: true });
    const config = join(sb.gitradarHome, 'config.yml');
    await writeFile(config, 'orgs: []\n');
    await symlink(victim, `${config}.bak`);

    const r = await runCli(sb, ['org', 'add', '--name', 'Acme', '--type', 'core', '--team', 'T']);
    expect(r.exitCode).toBe(0);
    expect(await readFile(victim, 'utf-8')).toBe('keep me\n');
    expect((await lstat(`${config}.bak`)).isSymbolicLink()).toBe(false);
    expect(await readFile(config, 'utf-8')).toContain('name: Acme');
  });
});
