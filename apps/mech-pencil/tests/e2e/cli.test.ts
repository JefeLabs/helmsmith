/**
 * End-to-end: drive the real CLI (`bun src/cli.ts`) and assert the
 * generated single-file document is structurally valid Pencil JSON.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
let work: string;

function run(args: string[]): string {
  return execFileSync('bun', [CLI, ...args], { encoding: 'utf8' });
}

describe('mech-pencil CLI (e2e)', () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'mech-pencil-'));
  });
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('lists frameworks', () => {
    expect(run(['list'])).toContain('heroui');
  });

  it('lists the HeroUI atomic catalog', () => {
    const out = run(['list', '--framework', 'heroui']);
    expect(out).toMatch(/atoms \(\d+\)/);
    expect(out).toContain('Button');
  });

  it('init generates one valid v2.11 .pen with components + a screen', () => {
    run(['init', '--framework', 'heroui', '--dir', work]);

    const file = join(work, 'design.pen');
    const doc = JSON.parse(readFileSync(file, 'utf8'));

    expect(doc.version).toBe('2.11');
    expect(doc.themes.mode).toEqual(['light', 'dark']);
    expect(doc.imports).toBeUndefined(); // single-file: no cross-file imports

    // one DS palette frame + at least one screen, all top-level
    const ids = doc.children.map((c: { id: string }) => c.id);
    expect(ids).toContain('design-system');
    expect(ids).toContain('screen');

    // no node id may contain '/'
    const walk = (n: { id?: string; children?: unknown[] }): string[] => [
      ...(n.id ? [n.id] : []),
      ...((n.children as { id?: string; children?: unknown[] }[] | undefined) ?? []).flatMap(walk),
    ];
    const allIds = (doc.children as { id?: string }[]).flatMap(walk);
    expect(allIds.some((id) => id.includes('/'))).toBe(false);

    expect(run(['validate', file])).toContain('valid');
  });
});
