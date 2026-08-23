import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
describe('docs tell the truth', () => {
  it('README links resolve', () => {
    for (const m of read('README.md').matchAll(/\]\((docs\/[^)]+)\)/g))
      expect(existsSync(join(root, m[1]))).toBe(true);
  });
  it('no doc claims Node/better-sqlite3 or dead commands', () => {
    const all = [
      'README.md',
      'docs/getting-started.md',
      'docs/executive-overview.md',
      'docs/feature-overview.md',
      'docs/architecture.md',
    ]
      .map(read)
      .join('\n');
    for (const bad of [
      'better-sqlite3',
      'Node.js ≥ 20',
      'gitradar data enrich',
      'workspace use',
      'repo add ~/code/my-project --name',
      'max_scan_age_weeks',
      'feature-tour.md',
      // Repos come from the workspace registry (repos.yml), not config.yml, and
      // `config/loader.ts` no longer expands or resolves repo paths.
      'repo paths in a single `config.yml`',
      'expands paths',
      'paths resolved',
      // MAX_RECENT_HASHES is 5000 (store/scan-state.ts).
      'last 500 per repo',
    ])
      expect(all, bad).not.toContain(bad);
  });
  it('package.json declares the Bun engine', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.engines?.bun).toMatch(/^>=1\./);
    expect(pkg.dependencies?.commander).toBeUndefined();
  });
});
