/**
 * Flatten a multi-file doc into a SELF-CONTAINED one for headless rendering.
 *
 * Pencil's headless `--export` only computes a valid bbox for docs with no
 * cross-file imports. So for the PNG step we render a flattened copy:
 *   1. inline every token as an own `variable` (so refs resolve in-file),
 *   2. rewrite `$alias:key` → `$key`,
 *   3. drop `imports`,
 *   4. drop cross-file component refs (`alias:id`) — they can't resolve without
 *      their lib; their pages are demoed via their own artifact's PNG anyway.
 * The persisted `.lib.pen` keeps its imports (option A); only the throwaway
 * render copy is flattened.
 */

import type { TokenSet } from '../design-system/tokens.ts';

type Obj = Record<string, unknown>;
const ALIAS_VAR = /^\$[a-z][a-z0-9]*:(.+)$/; // $alias:key → captures key

function rewrite(value: unknown): unknown {
  if (typeof value === 'string') {
    const m = ALIAS_VAR.exec(value);
    return m ? `$${m[1]}` : value;
  }
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v);
    return out;
  }
  return value;
}

/** Drop cross-file component refs (`ref` containing `:` or `/`) from a tree. */
function dropCrossFileRefs(node: Obj): Obj | null {
  if (node.type === 'ref' && typeof node.ref === 'string' && /[:/]/.test(node.ref)) return null;
  if (Array.isArray(node.children)) {
    node.children = (node.children as Obj[])
      .map(dropCrossFileRefs)
      .filter((n): n is Obj => n !== null);
  }
  return node;
}

export function flattenForRender(docObj: Obj, tokens: TokenSet): Obj {
  const c = structuredClone(docObj) as Obj;

  // 1. inline all tokens as own variables
  const vars = (c.variables ?? {}) as Obj;
  for (const col of tokens.colors) {
    vars[col.key] = {
      type: 'color',
      value: [
        { value: col.values.light, theme: { mode: 'light' } },
        { value: col.values.dark, theme: { mode: 'dark' } },
      ],
    };
  }
  for (const s of tokens.scalars) {
    vars[s.key] = s.type === 'number' ? { type: 'number', value: s.value } : { type: 'string', value: s.value };
  }
  c.variables = vars;
  c.themes = c.themes ?? { mode: ['light', 'dark'] };

  // 2. no imports in a self-contained render copy
  delete c.imports;

  // 3. drop cross-file refs, then 4. rewrite $alias:key → $key everywhere
  c.children = ((c.children as Obj[]) ?? [])
    .map(dropCrossFileRefs)
    .filter((n): n is Obj => n !== null);
  return rewrite(c) as Obj;
}