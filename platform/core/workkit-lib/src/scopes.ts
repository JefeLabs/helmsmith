import picomatch from 'picomatch';
import { WorkkitError } from './errors.js';
import type { Manifest, Mode } from './types.js';

/** `{group}` = every segment but the last, `{section}` = the last segment of an area path. */
export function areaVars(area: string): { group: string; section: string } {
  const parts = area.split('/');
  return { group: parts.slice(0, -1).join('/'), section: parts[parts.length - 1] };
}

function fill(template: string, vars: Record<string, string | undefined>): string | null {
  let missing = false;
  const out = template.replace(/\{(group|section|module)\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined || v === '') {
      missing = true;
      return '';
    }
    return v;
  });
  return missing ? null : out;
}

/** The globs an effort on `area` holds exclusively in `mode`; backend templates need the area's module. */
export function expandScopes(m: Manifest, area: string, mode: Mode): string[] {
  const spec = m.areas[area];
  if (!spec)
    throw new WorkkitError(
      'AREA_UNKNOWN',
      `unknown area "${area}" (known: ${Object.keys(m.areas).join(', ')})`,
    );
  const vars = { ...areaVars(area), module: spec.module };
  const out: string[] = [];
  for (const t of m.scopes.frontend) {
    const g = fill(t, vars);
    if (g) out.push(g);
  }
  if (mode === 'fullstack') {
    if (!spec.module) {
      throw new WorkkitError(
        'MANIFEST_INVALID',
        `area "${area}" has no module, so a fullstack effort cannot hold a backend scope; add areas["${area}"].module or use --mode frontend`,
      );
    }
    for (const t of m.scopes.backend) {
      const g = fill(t, vars);
      if (g) out.push(g);
    }
  }
  out.push(...(spec.extraScopes ?? []));
  return out;
}

/** The part of a glob before its first wildcard character. */
export function literalPrefix(glob: string): string {
  const i = glob.search(/[*?[{]/);
  return i < 0 ? glob : glob.slice(0, i);
}

/** Pairs `a ~ b` whose literal prefixes nest either way: a conservative overlap test. */
export function globsOverlap(a: string[], b: string[]): string[] {
  const pairs: string[] = [];
  for (const x of a) {
    const px = literalPrefix(x);
    for (const y of b) {
      const py = literalPrefix(y);
      if (px.startsWith(py) || py.startsWith(px)) pairs.push(`${x} ~ ${y}`);
    }
  }
  return pairs;
}

export function pathsMatching(paths: string[], globs: string[]): string[] {
  if (globs.length === 0) return [];
  const isMatch = picomatch(globs, { dot: true });
  return paths.filter((p) => isMatch(p));
}

/** Names of the commons any of `paths` falls under. */
export function commonsTouched(m: Manifest, paths: string[]): string[] {
  return Object.entries(m.commons)
    .filter(([, globs]) => pathsMatching(paths, globs).length > 0)
    .map(([name]) => name);
}
