/**
 * config.yml handling end to end (#113): an invalid file is never written over, a valid
 * file keeps its comments, and every reader says what is wrong.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

const INVALID = [
  'orgs:',
  '  - name: Acme',
  '    type: Core',
  '    teams:',
  '      - name: T',
  '',
].join('\n');
const COMMENTED = [
  '# Team config — keep in sync with HR',
  'orgs:',
  '  - name: Acme   # core org',
  '    type: core',
  '    teams:',
  '      - name: Platform',
  '        tag: infra',
  '        members: []',
  'settings:',
  '  weeks_back: 8  # two months',
  '',
].join('\n');

describe('config.yml', () => {
  let sb: Sandbox;
  let configPath: string;
  beforeEach(async () => {
    sb = await createSandbox();
    configPath = join(sb.gitradarHome, 'config.yml');
    await mkdir(sb.gitradarHome, { recursive: true });
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('org add on an invalid config exits non-zero and leaves the file byte-identical', async () => {
    await writeFile(configPath, INVALID);
    const r = await runCli(sb, ['org', 'add', '--name', 'Gamma', '--type', 'core', '--team', 'T']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/type/);
    expect(await readFile(configPath, 'utf-8')).toBe(INVALID);
  });

  it('org add on a valid config keeps comments and the existing org, and leaves a .bak', async () => {
    await writeFile(configPath, COMMENTED);
    const r = await runCli(sb, [
      'org',
      'add',
      '--name',
      'Beta',
      '--type',
      'consultant',
      '--team',
      'T',
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const after = await readFile(configPath, 'utf-8');
    for (const c of ['# Team config — keep in sync with HR', '# core org', '# two months']) {
      expect(after).toContain(c);
    }
    expect(after).toContain('name: Acme');
    expect(after).toContain('tag: infra');
    expect(after).toContain('name: Beta');
    expect(after).not.toContain('aliases');
    expect(await readFile(`${configPath}.bak`, 'utf-8')).toBe(COMMENTED);
  });

  it('org list on an invalid config exits non-zero with the issue', async () => {
    await writeFile(configPath, INVALID);
    const r = await runCli(sb, ['org', 'list']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/type/);
  });

  it('scan on an invalid config prints the validation error', async () => {
    await writeFile(configPath, INVALID);
    const r = await runCli(sb, ['scan']);
    expect(r.stderr).toMatch(/Config validation failed/);
    expect(r.stderr).toMatch(/type/);
    expect(await readFile(configPath, 'utf-8')).toBe(INVALID);
  });
});
