/**
 * An invalid repos.yml must stop gitradar, not be replaced by an empty registry (#114).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

const INVALID = ['workspaces:', '  default:', '    repos:', '      - path: /tmp/no-name', ''].join(
  '\n',
);

describe('invalid repos.yml', () => {
  let sb: Sandbox;
  let registryPath: string;
  beforeEach(async () => {
    sb = await createSandbox();
    registryPath = join(sb.home, '.agentx', 'repos.yml');
    await mkdir(join(sb.home, '.agentx'), { recursive: true });
    await writeFile(registryPath, INVALID);
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('bare `gitradar` exits non-zero, names the issue and leaves the file unchanged', async () => {
    const r = await runCli(sb, []);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/Invalid repos\.yml format/);
    expect(r.stderr).toMatch(/name/);
    expect(r.stdout).not.toMatch(/Create one/);
    expect(await readFile(registryPath, 'utf-8')).toBe(INVALID);
  });

  it('`workspace list` exits non-zero and leaves the file unchanged', async () => {
    const r = await runCli(sb, ['workspace', 'list']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/Invalid repos\.yml format/);
    expect(await readFile(registryPath, 'utf-8')).toBe(INVALID);
  });
});
