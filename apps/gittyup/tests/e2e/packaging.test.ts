/**
 * The published package must be installable from npm: no `workspace:` ranges and no
 * `@helmsmith/*` runtime dependencies (they are bundled into dist), and the TUI's
 * third-party peers are declared (C6). Guards against re-introducing an unpublishable dep.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP = resolve(import.meta.dirname, '../..');
let dir: string;
let pkg: { dependencies?: Record<string, string> };
let entries: string[];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gittyup-pack-'));
  execFileSync('pnpm', ['pack', '--pack-destination', dir], { cwd: APP, stdio: 'pipe' });
  const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('pnpm pack produced no tarball');
  entries = execFileSync('tar', ['-tzf', join(dir, tgz)], { encoding: 'utf-8' }).split('\n');
  execFileSync('tar', ['-xzf', join(dir, tgz), '-C', dir], { stdio: 'pipe' });
  pkg = JSON.parse(readFileSync(join(dir, 'package', 'package.json'), 'utf-8'));
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('published package is installable (C6)', () => {
  it('has no workspace: ranges and no @helmsmith/* runtime deps', () => {
    const deps = pkg.dependencies ?? {};
    for (const [name, range] of Object.entries(deps)) {
      expect(name, `runtime dep ${name}`).not.toMatch(/^@helmsmith\//);
      expect(String(range), `range of ${name}`).not.toContain('workspace:');
    }
  });

  it('declares the TUI third-party peers it bundles against', () => {
    const deps = pkg.dependencies ?? {};
    expect(deps['@opentui/react']).toBeTruthy();
    expect(deps.react).toBeTruthy();
  });

  it('ships the launcher and the built entry', () => {
    expect(entries).toContain('package/bin/gittyup.mjs');
    expect(entries).toContain('package/dist/cli.js');
  });
});
