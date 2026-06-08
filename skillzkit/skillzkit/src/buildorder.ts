/**
 * Build-order queries over the catalog's `dependsOn`/`dependents` graph
 * (computed in load.ts by matching `produces` → `requires`).
 *
 * `references`/`referencedBy` answer "who *mentions* whom"; this module
 * answers "what must run *before* what" — the artifact-derived build order
 * the scaffold/greenfield pipeline needs.
 */

import type { Command } from './types.js';

/**
 * Topologically sort commands by `dependsOn` (dependencies first). Edges
 * to slugs outside `commands` are ignored. Throws on a cycle, naming the
 * path so a bad `requires`/`produces` pairing is easy to find.
 */
export function buildOrder(commands: Command[]): Command[] {
  const bySlug = new Map(commands.map((c) => [c.slug, c]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const order: Command[] = [];

  function visit(slug: string): void {
    const s = state.get(slug);
    if (s === 'done') return;
    if (s === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(slug)), slug].join(' → ');
      throw new Error(`build-order cycle: ${cycle}`);
    }
    const cmd = bySlug.get(slug);
    if (!cmd) return; // edge to a slug outside this set
    state.set(slug, 'visiting');
    stack.push(slug);
    for (const dep of cmd.dependsOn) visit(dep);
    stack.pop();
    state.set(slug, 'done');
    order.push(cmd);
  }

  for (const c of commands) visit(c.slug);
  return order;
}

/** A node in a build-order dependency tree. */
export interface DepNode {
  slug: string;
  dependsOn: DepNode[];
}

/**
 * The transitive `dependsOn` tree rooted at `slug` (everything that must
 * run before it, recursively). A repeated slug on a path becomes a leaf so
 * cycles don't recurse forever.
 */
export function dependencyTree(slug: string, commands: Command[]): DepNode {
  const bySlug = new Map(commands.map((c) => [c.slug, c]));
  function build(s: string, seen: Set<string>): DepNode {
    const cmd = bySlug.get(s);
    if (!cmd || seen.has(s)) return { slug: s, dependsOn: [] };
    const next = new Set(seen).add(s);
    return { slug: s, dependsOn: cmd.dependsOn.map((d) => build(d, next)) };
  }
  return build(slug, new Set());
}