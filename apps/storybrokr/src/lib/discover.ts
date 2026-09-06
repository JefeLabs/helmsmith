// src/lib/discover.ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { StorybrokrError } from './errors.js';

export interface DiscoveryResult {
  storyFiles: string[];
  modulesVisited: number;
  unresolved: string[];
}

const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];
const STORY_RE = /\.stories\.(tsx|ts|jsx|js|mdx)$/;
const SKIP_RE = /\.(stories|test|spec|types)\./;
const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveFile(base: string): string | null {
  for (const ext of ['', ...SOURCE_EXTS]) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  for (const ext of SOURCE_EXTS) {
    const f = join(base, `index${ext}`);
    if (existsSync(f)) return f;
  }
  return null;
}

function resolveAlias(
  spec: string,
  hostRoot: string,
  paths: Record<string, string[]>,
): string | null {
  for (const [pattern, targets] of Object.entries(paths)) {
    const prefix = pattern.replace(/\*$/, '');
    if (!spec.startsWith(prefix)) continue;
    const rest = spec.slice(prefix.length);
    for (const target of targets) {
      const found = resolveFile(join(hostRoot, target.replace(/\*$/, ''), rest));
      if (found) return found;
    }
  }
  return null;
}

/** Local specifiers only: relative paths and tsconfig aliases. Bare packages return null. */
function resolveImport(
  fromFile: string,
  spec: string,
  hostRoot: string,
  paths: Record<string, string[]>,
) {
  if (spec.startsWith('.'))
    return { local: true, file: resolveFile(resolve(dirname(fromFile), spec)) };
  const viaAlias = resolveAlias(spec, hostRoot, paths);
  const isAliasShaped = Object.keys(paths).some((p) => spec.startsWith(p.replace(/\*$/, '')));
  return { local: isAliasShaped, file: viaAlias };
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out = new Set<string>();
  for (const re of [STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    for (;;) {
      const m = re.exec(src);
      if (m === null) break;
      out.add(m[1]);
    }
  }
  return [...out];
}

/** Sibling story files whose basename starts with the module's basename; index modules take the whole dir. */
function storyFilesFor(file: string): string[] {
  const dir = dirname(file);
  const base = basename(file).replace(/\.(tsx|ts|jsx|js)$/, '');
  return readdirSync(dir)
    .filter(
      (f) => STORY_RE.test(f) && (base === 'index' || f.replace(STORY_RE, '').startsWith(base)),
    )
    .map((f) => join(dir, f));
}

export function discoverStories(
  hostRoot: string,
  component: string,
  tsconfigPaths: Record<string, string[]>,
): DiscoveryResult {
  const abs = resolve(hostRoot, component);
  if (!existsSync(abs)) {
    throw new StorybrokrError(
      'COMPONENT_NOT_FOUND',
      `${component} does not exist under ${hostRoot}`,
    );
  }
  const stories = new Set<string>();
  const queue: string[] = [];
  if (statSync(abs).isDirectory()) {
    for (const f of readdirSync(abs)) {
      const full = join(abs, f);
      if (STORY_RE.test(f)) stories.add(full);
      else if (
        SOURCE_EXTS.some((e) => f.endsWith(e)) &&
        !SKIP_RE.test(f) &&
        statSync(full).isFile()
      )
        queue.push(full);
    }
  } else {
    if (STORY_RE.test(abs)) stories.add(abs);
    queue.push(abs);
  }

  const seen = new Set<string>();
  const unresolved: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file) || file.includes('/node_modules/')) continue;
    seen.add(file);
    for (const s of storyFilesFor(file)) stories.add(s);
    for (const spec of importsOf(file)) {
      const { local, file: target } = resolveImport(file, spec, hostRoot, tsconfigPaths);
      if (!local) continue;
      if (!target) {
        unresolved.push(`${relative(hostRoot, file)} -> ${spec}`);
        continue;
      }
      if (!target.includes('/node_modules/') && !seen.has(target)) queue.push(target);
    }
  }

  const storyFiles = [...stories].map((s) => relative(hostRoot, s)).sort();
  if (storyFiles.length === 0) {
    throw new StorybrokrError(
      'COMPONENT_NOT_FOUND',
      `no *.stories.* files reachable from ${component}`,
    );
  }
  return { storyFiles, modulesVisited: seen.size, unresolved };
}
