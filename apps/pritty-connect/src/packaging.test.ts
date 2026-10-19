import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  dependencies?: Record<string, string>;
};

describe('@helmsmith/pritty-connect packaging', () => {
  beforeAll(() => {
    execFileSync('pnpm', ['exec', 'tsup'], { cwd: root, stdio: 'pipe' });
  }, 120_000);

  it('builds a bin that answers --version (re-executing under the vendored bun)', () => {
    expect(existsSync(join(root, 'dist/cli.js'))).toBe(true);
    const out = execFileSync(
      process.execPath,
      [join(root, 'bin/pritty-connect.mjs'), '--version'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      },
    );
    expect(out.trim()).toBe(pkg.version);
  });

  it('declares the TUI stack and pritty, and bundles only the private view library', () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const d of ['bun', '@opentui/core', '@opentui/react', 'react', '@helmsmith/pritty']) {
      expect(deps).toContain(d);
    }
    expect(deps).not.toContain('@helmsmith/tui-view-components');
    const dist = readFileSync(join(root, 'dist/cli.js'), 'utf8');
    expect(dist).not.toMatch(/from "@helmsmith\/tui-view-components"/);
    expect(dist).toMatch(/from "@helmsmith\/pritty"/);
  });
});
