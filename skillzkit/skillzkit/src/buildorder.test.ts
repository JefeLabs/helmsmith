import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOrder, dependencyTree } from './buildorder.js';
import { loadCommands } from './load.js';
import type { Command } from './types.js';

function cmd(slug: string, dependsOn: string[] = []): Command {
  return {
    slug,
    path: `${slug.split(':').join('/')}.md`,
    kind: 'command',
    description: slug,
    references: [],
    referencedBy: [],
    dependsOn,
    dependents: [],
    body: '',
    frontmatter: {},
  };
}

describe('buildOrder', () => {
  it('orders dependencies before dependents', () => {
    const cmds = [cmd('a:forms', ['a:buttons']), cmd('a:buttons', ['a:surfaces']), cmd('a:surfaces')];
    const order = buildOrder(cmds).map((c) => c.slug);
    expect(order.indexOf('a:surfaces')).toBeLessThan(order.indexOf('a:buttons'));
    expect(order.indexOf('a:buttons')).toBeLessThan(order.indexOf('a:forms'));
  });

  it('ignores edges to slugs outside the set', () => {
    const order = buildOrder([cmd('a:x', ['a:not-in-set'])]).map((c) => c.slug);
    expect(order).toEqual(['a:x']);
  });

  it('throws on a cycle, naming the path', () => {
    const cmds = [cmd('a:x', ['a:y']), cmd('a:y', ['a:x'])];
    expect(() => buildOrder(cmds)).toThrow(/build-order cycle/);
  });
});

describe('dependencyTree', () => {
  it('builds the transitive dependsOn tree', () => {
    const cmds = [cmd('a:forms', ['a:buttons']), cmd('a:buttons', ['a:surfaces']), cmd('a:surfaces')];
    const tree = dependencyTree('a:forms', cmds);
    expect(tree.dependsOn[0].slug).toBe('a:buttons');
    expect(tree.dependsOn[0].dependsOn[0].slug).toBe('a:surfaces');
  });

  it('cuts cycles (repeated slug becomes a leaf)', () => {
    const cmds = [cmd('a:x', ['a:y']), cmd('a:y', ['a:x'])];
    const tree = dependencyTree('a:x', cmds);
    expect(tree.dependsOn[0].slug).toBe('a:y');
    expect(tree.dependsOn[0].dependsOn[0].dependsOn).toEqual([]); // a:x cut on repeat
  });
});

describe('loadCommands — build-order graph from requires/produces', () => {
  it('matches produces → requires (exact + glob) into dependsOn/dependents', () => {
    const root = mkdtempSync(join(tmpdir(), 'skillzkit-bo-'));
    try {
      mkdirSync(join(root, 'd'), { recursive: true });
      const write = (name: string, fm: string) =>
        writeFileSync(join(root, 'd', `${name}.md`), `---\n${fm}\n---\nbody\n`);
      // surfaces produces a .pen; buttons requires it exactly; an aggregator
      // requires a glob that surfaces' output also satisfies.
      write('surfaces', 'description: surfaces\nproduces:\n  - design/components/surfaces.pen');
      write('buttons', 'description: buttons\nrequires:\n  - design/components/surfaces.pen\nproduces:\n  - design/components/buttons.pen');
      write('all', 'description: all\nrequires:\n  - design/components/*.pen');

      const cmds = loadCommands(root);
      const bySlug = Object.fromEntries(cmds.map((c) => [c.slug, c]));
      expect(bySlug['d:buttons'].dependsOn).toEqual(['d:surfaces']);
      expect(bySlug['d:surfaces'].dependents).toContain('d:buttons');
      // glob require matches both producers
      expect(bySlug['d:all'].dependsOn.sort()).toEqual(['d:buttons', 'd:surfaces']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});