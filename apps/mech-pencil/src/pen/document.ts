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
    const doc: Document = { version: PEN_VERSION, children: this.children };
    if (Object.keys(this.themes).length > 0) doc.themes = this.themes;
    if (Object.keys(this.imports).length > 0) doc.imports = this.imports;
    if (Object.keys(this.variables).length > 0) doc.variables = this.variables;
    // Spec recommends version → themes → imports → variables → children;
    // mirror that ordering for readable, minimal diffs.
    return {
      version: doc.version,
      ...(doc.themes ? { themes: doc.themes } : {}),
      ...(doc.imports ? { imports: doc.imports } : {}),
      ...(doc.variables ? { variables: doc.variables } : {}),
      children: doc.children,
    };
  }

  /** Serialize to the on-disk JSON form (2-space indent + newline). */
  toJSON(): string {
    return `${JSON.stringify(this.toObject(), null, 2)}\n`;
  }
}
