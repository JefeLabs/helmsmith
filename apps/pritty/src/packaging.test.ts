import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The published artifact is `dist/` plus `bin/`, resolved against the
 * consumer's node_modules. These tests build it once and then check the
 * three things an `npm i -g` would otherwise discover: an import nobody
 * declared, a dependency on a package that is private to the monorepo,
 * and a bin that cannot start under Node.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(root, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  dependencies?: Record<string, string>;
};
const runtimeDeps = Object.keys(pkg.dependencies ?? {});

function packageName(spec: string): string {
  if (spec.startsWith('@')) {
    const [scope, name] = spec.split('/');
    return `${scope}/${name}`;
  }
  return spec.split('/')[0] ?? spec;
}

function jsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...jsFilesUnder(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

function bareImports(file: string): Set<string> {
  const src = readFileSync(file, 'utf8');
  const out = new Set<string>();
  const re = /\bfrom\s*"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)|\brequire\s*\(\s*"([^"]+)"\s*\)/g;
  for (const m of src.matchAll(re)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec || spec.startsWith('.') || spec.startsWith('node:')) continue;
    if (builtinModules.includes(spec)) continue;
    out.add(packageName(spec));
  }
  return out;
}

/** name → private flag for every workspace package (depth-limited walk, no node_modules). */
function workspacePackages(): Map<string, boolean> {
  const found = new Map<string, boolean>();
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const p = join(dir, entry);
      if (!statSync(p).isDirectory()) continue;
      const manifest = join(p, 'package.json');
      if (existsSync(manifest)) {
        const m = JSON.parse(readFileSync(manifest, 'utf8')) as {
          name?: string;
          private?: boolean;
        };
        if (m.name) found.set(m.name, Boolean(m.private));
      }
      walk(p, depth + 1);
    }
  };
  walk(repoRoot, 0);
  return found;
}

describe('packaging', () => {
  beforeAll(() => {
    execFileSync('pnpm', ['exec', 'tsup'], { cwd: root, stdio: 'pipe' });
  }, 120_000);

  it('every bare import in the built output is a declared runtime dependency', () => {
    const missing = new Set<string>();
    for (const file of jsFilesUnder(join(root, 'dist'))) {
      for (const name of bareImports(file)) if (!runtimeDeps.includes(name)) missing.add(name);
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('declares no private workspace package as a runtime dependency', () => {
    const workspace = workspacePackages();
    const privateDeps = runtimeDeps.filter((d) => workspace.get(d) === true);
    expect(privateDeps).toEqual([]);
  });

  // pnpm puts its hoisted store on NODE_PATH for scripts, and Bun honours it, which
  // would hide an undeclared dependency from these two checks.
  const cleanEnv = { ...process.env, NODE_PATH: '' };

  it('dist/cli.js loads under plain node', () => {
    const out = execFileSync(process.execPath, [join(root, 'dist/cli.js'), '--version'], {
      cwd: root,
      encoding: 'utf8',
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out.trim()).toBe(pkg.version);
  });

  it('the bin starts under node, without bun, for anything but the TUI', () => {
    const out = execFileSync(process.execPath, [join(root, 'bin/pritty.mjs'), '--version'], {
      cwd: root,
      encoding: 'utf8',
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out.trim()).toBe(pkg.version);
  });
});

describe('@helmsmith/pritty/core', () => {
  const heavy = [
    '@opentui/core',
    '@opentui/react',
    'openai',
    '@anthropic-ai/sdk',
    '@inquirer/prompts',
    'ora',
    'react',
  ];

  it('is a built entry that loads under node and exports the deterministic pieces', () => {
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import('./dist/core.js').then((m) => console.log(Object.keys(m).sort().join(',')))",
      ],
      { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
    );
    const names = out.trim().split(',');
    for (const n of [
      'createGit',
      'parseGitHubRemote',
      'describeRemote',
      'createPR',
      'updatePR',
      'listOpenPRs',
      'resolveGitHubToken',
      'findPullRequestTemplate',
      'findCodeowners',
      'loadConfig',
      'ConfigSchema',
      'resolveBaseBranch',
      'applyFooter',
      'applyTrailers',
      'inferLabels',
      'redactDiff',
    ]) {
      expect(names, `core export ${n}`).toContain(n);
    }
    expect(names).not.toContain('generatePR');
  });

  it('pulls in neither the AI adapters nor the TUI', () => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bfrom\s*"(\.\/[^"]+)"|\bimport\s*\(\s*"(\.\/[^"]+)"\s*\)/g)) {
        visit(join(root, 'dist', (m[1] ?? m[2])!));
      }
    };
    visit(join(root, 'dist', 'core.js'));
    const imported = new Set<string>();
    for (const f of seen) for (const n of bareImports(f)) imported.add(n);
    expect([...imported].filter((n) => heavy.includes(n))).toEqual([]);
  });

  it('is declared in package.json exports', () => {
    const exportsField = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      .exports as Record<string, unknown>;
    expect(exportsField['./core']).toBeDefined();
  });
});
