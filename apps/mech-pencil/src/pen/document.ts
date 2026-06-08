/**
 * `PenDocument` — assembles a valid `Document` and serializes it to the
 * on-disk JSON form (pretty-printed, trailing newline, stable key order
 * so diffs stay small and git-friendly, exactly as the spec recommends).
 *
 * Used for both outputs:
 *   - a `*.lib.pen` design library (reusable components + variables)
 *   - a `*.pen` mockup that `imports` a library and instantiates refs
 */

import {
  type Child,
  type Document,
  PEN_VERSION,
  type VariableDecl,
} from './schema.ts';

/**
 * Structural normalizations Pencil applies on save — emitting the un-normalized
 * form renders fine but **crashes the app when the document is resolved on
 * click** (Pencil resolves the whole doc, so one bad node crashes any click):
 *   - `ellipse` needs an explicit `x`/`y`; a full circle (sweep 360 from 0) is
 *     a plain ellipse, so the explicit arc params are dropped.
 *   - shadow effects drop a redundant `spread:0`.
 *   - gradient fills/strokes need `enabled:true`.
 * Applied recursively at serialization so every emit site is covered.
 */
/**
 * Convert an SVG path `d` to all-relative commands. Pencil's resolve path
 * rewrites absolute commands to relative on save; an absolute command mid-path
 * (e.g. FA's `…l0 144L48 224…`) is a form it crashes on when the node is
 * clicked. Bails to the original string on any unknown command / parse error.
 */
function pathToRelative(d: string): string {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!toks) return d;
  const argc: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  const out: string[] = [];
  const num = () => parseFloat(toks[i++]);
  try {
    while (i < toks.length) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
      const lc = cmd.toLowerCase();
      const abs = cmd === cmd.toUpperCase();
      if (lc === 'z') {
        out.push('z');
        cx = sx;
        cy = sy;
        continue;
      }
      const n = argc[lc];
      if (n === undefined) return d;
      const a: number[] = [];
      for (let k = 0; k < n; k++) a.push(num());
      if (lc === 'm') {
        const x = abs ? a[0] : cx + a[0];
        const y = abs ? a[1] : cy + a[1];
        out.push(`m${x - cx} ${y - cy}`);
        cx = x;
        cy = y;
        sx = x;
        sy = y;
        cmd = abs ? 'L' : 'l';
      } else if (lc === 'l' || lc === 't') {
        const x = abs ? a[0] : cx + a[0];
        const y = abs ? a[1] : cy + a[1];
        out.push(`${lc}${x - cx} ${y - cy}`);
        cx = x;
        cy = y;
      } else if (lc === 'h') {
        const x = abs ? a[0] : cx + a[0];
        out.push(`h${x - cx}`);
        cx = x;
      } else if (lc === 'v') {
        const y = abs ? a[0] : cy + a[0];
        out.push(`v${y - cy}`);
        cy = y;
      } else if (lc === 'c') {
        const p = abs ? [a[0] - cx, a[1] - cy, a[2] - cx, a[3] - cy, a[4] - cx, a[5] - cy] : a;
        out.push(`c${p.join(' ')}`);
        cx = abs ? a[4] : cx + a[4];
        cy = abs ? a[5] : cy + a[5];
      } else if (lc === 's' || lc === 'q') {
        const p = abs ? [a[0] - cx, a[1] - cy, a[2] - cx, a[3] - cy] : a;
        out.push(`${lc}${p.join(' ')}`);
        cx = abs ? a[2] : cx + a[2];
        cy = abs ? a[3] : cy + a[3];
      } else if (lc === 'a') {
        const x = abs ? a[5] : cx + a[5];
        const y = abs ? a[6] : cy + a[6];
        out.push(`a${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[4]} ${x - cx} ${y - cy}`);
        cx = x;
        cy = y;
      } else {
        return d;
      }
    }
  } catch {
    return d;
  }
  return out.join('').replace(/\s+/g, ' ').replace(/ -/g, '-').trim();
}

function normalizePencilNode(node: unknown): void {
  if (Array.isArray(node)) {
    for (const c of node) normalizePencilNode(c);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;

  if (n.type === 'ellipse') {
    if (n.x === undefined) n.x = 0;
    if (n.y === undefined) n.y = 0;
    if (n.startAngle === 0 && n.sweepAngle === 360) {
      delete n.startAngle;
      delete n.sweepAngle;
    }
  }

  if (n.type === 'path' && typeof n.geometry === 'string') {
    n.geometry = pathToRelative(n.geometry);
  }

  const effects = Array.isArray(n.effect) ? n.effect : n.effect ? [n.effect] : [];
  for (const e of effects) {
    if (e && typeof e === 'object' && (e as Record<string, unknown>).type === 'shadow' && (e as Record<string, unknown>).spread === 0) {
      delete (e as Record<string, unknown>).spread;
    }
  }

  for (const key of ['fill', 'stroke'] as const) {
    const v = n[key];
    const vals = Array.isArray(v) ? v : v ? [v] : [];
    for (const g of vals) {
      if (g && typeof g === 'object' && (g as Record<string, unknown>).type === 'gradient') {
        const gr = g as Record<string, unknown>;
        if (gr.enabled === undefined) gr.enabled = true;
        if (gr.size === undefined) gr.size = { height: 1 };
      }
    }
  }

  // Strip redundant defaults Pencil omits on save (it normalizes these away;
  // carrying them diverges from the resolve-path dialect).
  if (n.gap === 0) delete n.gap;
  if (n.cornerRadius === 0) delete n.cornerRadius;
  if (n.content === '') delete n.content;
  if (n.alignItems === 'start') delete n.alignItems;
  // Every text node carries an explicit fontWeight in Pencil's resolved form;
  // normal weight is the keyword "normal" (NOT "400", NOT absent — both of
  // which the resolve path rejects/crashes on). Normalize to that.
  if (n.type === 'text' && (n.fontWeight === undefined || n.fontWeight === '400')) {
    n.fontWeight = 'normal';
  }
  // Collapse symmetric padding to Pencil's compact form.
  if (Array.isArray(n.padding)) {
    const p = n.padding as unknown[];
    const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (p.length > 1 && p.every((x) => eq(x, p[0]))) n.padding = p[0];
    else if (p.length === 4 && eq(p[0], p[2]) && eq(p[1], p[3])) n.padding = [p[0], p[1]];
  }

  if (Array.isArray(n.children)) normalizePencilNode(n.children);
}

export class PenDocument {
  private themes: Record<string, string[]> = {};
  private imports: Record<string, string> = {};
  private variables: Record<string, VariableDecl> = {};
  private children: Child[] = [];

  /** Declare a theme axis (e.g. `axis("mode", ["light","dark"])`). */
  axis(name: string, values: string[]): this {
    this.themes[name] = values;
    return this;
  }

  /**
   * Add an import alias → relative path to a `.pen`/`.lib.pen`. The leading
   * `./` is stripped: Pencil expects `foundations/x.lib.pen`, not
   * `./foundations/x.lib.pen` — the `./` form fails import resolution and
   * crashes the app when a node referencing the import is clicked. (`../`
   * parent-relative paths are preserved.)
   */
  importLib(alias: string, relativePath: string): this {
    this.imports[alias] = relativePath.replace(/^\.\//, '');
    return this;
  }

  /** Declare a design token. `key` is referenced elsewhere as `"$key"`. */
  variable(key: string, decl: VariableDecl): this {
    this.variables[key] = decl;
    return this;
  }

  /** Append a top-level node (component definition, frame, mockup, …). */
  add(...nodes: Child[]): this {
    this.children.push(...nodes);
    return this;
  }

  /** Build the plain schema object (no app-specific wrappers). */
  toObject(): Document {
    for (const child of this.children) normalizePencilNode(child);
    const doc: Document = { version: PEN_VERSION, children: this.children };
    if (Object.keys(this.themes).length > 0) doc.themes = this.themes;
    if (Object.keys(this.imports).length > 0) doc.imports = this.imports;
    if (Object.keys(this.variables).length > 0) doc.variables = this.variables;
    // Match Pencil's own save order (verified against an app-saved file):
    // version → themes → variables → children → imports. Re-saves then
    // produce minimal diffs, and the imports-last form matches the layout
    // the app emits.
    return {
      version: doc.version,
      ...(doc.themes ? { themes: doc.themes } : {}),
      ...(doc.variables ? { variables: doc.variables } : {}),
      children: doc.children,
      ...(doc.imports ? { imports: doc.imports } : {}),
    };
  }

  /** Serialize to the on-disk JSON form (2-space indent + newline). */
  toJSON(): string {
    return `${JSON.stringify(this.toObject(), null, 2)}\n`;
  }
}
