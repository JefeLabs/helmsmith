import picomatch from 'picomatch';
import { WorkkitError } from './errors.js';
import type { AreaSpec, Effort, Manifest, Mode } from './types.js';

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

function extraScopesForMode(spec: AreaSpec, mode: Mode): string[] {
  if (!spec.extraScopes) return [];
  if (Array.isArray(spec.extraScopes)) {
    return mode === 'frontend' || mode === 'fullstack' ? spec.extraScopes : [];
  }
  const out: string[] = [];
  if (mode === 'frontend' || mode === 'fullstack') out.push(...(spec.extraScopes.frontend ?? []));
  if (mode === 'backend' || mode === 'fullstack') out.push(...(spec.extraScopes.backend ?? []));
  return out;
}

const normalizeGlob = (g: string) => g.replace(/^\.\//, '').replace(/\/+$/, '');
const hasWildcard = (s: string) => /[*?[{]/.test(s);

/** True when every path matched by `child` is guaranteed to be inside `parent`. */
export function isSubGlob(child: string, parent: string): boolean {
  const c = normalizeGlob(child);
  const p = normalizeGlob(parent);
  if (c === p) return true;
  const cSegs = c.split('/');
  const pSegs = p.split('/');
  for (let i = 0; i < pSegs.length; i++) {
    const ps = pSegs[i];
    if (ps === '**') return true;
    const cs = cSegs[i];
    if (cs === undefined || cs === '**') return false;
    if (!hasWildcard(ps) && !hasWildcard(cs)) {
      if (ps !== cs) return false;
      continue;
    }
    if (!hasWildcard(cs) && hasWildcard(ps)) {
      if (!picomatch.isMatch(cs, ps, { dot: true })) return false;
      continue;
    }
    if (cs !== ps) return false;
  }
  return cSegs.length === pSegs.length;
}

/** The globs an effort on `area` holds exclusively in `mode`; backend/fullstack templates need the area's module. */
export function expandScopes(
  m: Manifest,
  area: string,
  mode: Mode,
  narrowedScopes?: string[],
  hasTask = false,
): string[] {
  const spec = m.areas[area];
  if (!spec)
    throw new WorkkitError(
      'AREA_UNKNOWN',
      `unknown area "${area}" (known: ${Object.keys(m.areas).join(', ')})`,
    );
  const vars = { ...areaVars(area), module: spec.module };
  const out: string[] = [];
  if (mode === 'frontend' || mode === 'fullstack') {
    for (const t of m.scopes.frontend) {
      const g = fill(t, vars);
      if (g) out.push(g);
    }
  }
  if (mode === 'backend' || mode === 'fullstack') {
    if (!spec.module) {
      throw new WorkkitError(
        'MANIFEST_INVALID',
        `area "${area}" has no module, so a ${mode} effort cannot hold a backend scope; add areas["${area}"].module or use --mode frontend`,
      );
    }
    for (const t of m.scopes.backend) {
      const g = fill(t, vars);
      if (g) out.push(g);
    }
  }
  out.push(...extraScopesForMode(spec, mode));
  if (!narrowedScopes || narrowedScopes.length === 0) return out;
  if (!hasTask) {
    throw new WorkkitError(
      'SCOPE_REQUIRES_TASK',
      '--scope narrowing requires --task <slug> so primary area efforts always protect the full area',
    );
  }
  const allowed = [...out, ...(spec.sharedScopes ?? [])];
  for (const g of narrowedScopes) {
    if (!allowed.some((base) => isSubGlob(g, base))) {
      throw new WorkkitError(
        'SCOPE_OUTSIDE_AREA',
        `narrowed scope "${g}" is outside ${area}'s ${mode} scopes (${allowed.join(', ')})`,
        { area, mode, scope: g, allowed },
      );
    }
  }
  return narrowedScopes;
}

/** All globs an effort is allowed to touch without an out-of-scope warning (exclusive scopes + sharedScopes + commons). */
export function allowedScopesForEffort(
  m: Manifest,
  effort: Pick<Effort, 'area' | 'scopes'>,
): string[] {
  const shared = m.areas[effort.area]?.sharedScopes ?? [];
  const allCommons = Object.values(m.commons).flat();
  return [...effort.scopes, ...shared, ...allCommons];
}

/** The part of a glob before its first wildcard character. */
export function literalPrefix(glob: string): string {
  const i = glob.search(/[*?[{]/);
  return i < 0 ? glob : glob.slice(0, i);
}

function segmentsOverlap(sx: string, sy: string): boolean {
  if (sx === sy) return true;
  const wx = hasWildcard(sx);
  const wy = hasWildcard(sy);
  if (!wx && !wy) return false;
  if (!wx && wy) return picomatch.isMatch(sx, sy, { dot: true });
  if (wx && !wy) return picomatch.isMatch(sy, sx, { dot: true });
  const starToken = /^\*([^*?[{]+)\*$/;
  const mx = starToken.exec(sx);
  const my = starToken.exec(sy);
  if (mx && my) {
    const tx = mx[1];
    const ty = my[1];
    return tx.includes(ty) || ty.includes(tx);
  }
  return true;
}

function twoGlobsOverlap(x: string, y: string): boolean {
  const xs = normalizeGlob(x).split('/');
  const ys = normalizeGlob(y).split('/');
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i++) {
    if (xs[i] === '**' || ys[i] === '**') return true;
    if (!segmentsOverlap(xs[i], ys[i])) return false;
  }
  if (xs.length === ys.length) return true;
  const longer = xs.length > ys.length ? xs : ys;
  return longer[len] === '**';
}

/** Pairs `a ~ b` whose path segments overlap. */
export function globsOverlap(a: string[], b: string[]): string[] {
  const pairs: string[] = [];
  for (const x of a) {
    for (const y of b) {
      if (twoGlobsOverlap(x, y)) pairs.push(`${x} ~ ${y}`);
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
