import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { HostInfo } from '../types.js';
import { StorybrokrError } from './errors.js';
import { readTsconfigPaths } from './tsconfig.js';

const MAIN_EXTS = ['ts', 'mts', 'js', 'mjs', 'cjs'];
const PREVIEW_EXTS = ['tsx', 'ts', 'jsx', 'js', 'mjs'];

export const MIN_STORYBOOK_MAJOR = 7;

function firstExisting(dir: string, base: string, exts: string[]): string | null {
  for (const ext of exts) {
    const file = join(dir, `${base}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Walk up from startPath until a directory containing `.storybook/` is found. */
export function findHostRoot(startPath: string): string | null {
  let dir = resolve(startPath);
  for (;;) {
    if (existsSync(join(dir, '.storybook'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Best-effort framework name from the main config text; 'unknown' if not found. */
export function detectFramework(mainSource: string): string {
  const objectForm = mainSource.match(/framework\s*:\s*\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`]/s);
  if (objectForm) return objectForm[1];
  const stringForm = mainSource.match(/framework\s*:\s*['"`]([^'"`]+)['"`]/);
  if (stringForm) return stringForm[1];
  // getAbsolutePath('@storybook/nextjs') style
  const helperForm = mainSource.match(
    /framework[\s\S]{0,80}?\(\s*['"`](@storybook\/[a-z0-9-]+)['"`]/,
  );
  return helperForm ? helperForm[1] : 'unknown';
}

export function inspectHost(hostRoot: string): HostInfo {
  const storybookDir = join(hostRoot, '.storybook');
  const mainFile = firstExisting(storybookDir, 'main', MAIN_EXTS);
  if (!mainFile) {
    throw new StorybrokrError(
      'HOST_INVALID',
      `${storybookDir} has no main.{${MAIN_EXTS.join(',')}}`,
    );
  }
  const storybookBin = join(hostRoot, 'node_modules', '.bin', 'storybook');
  if (!existsSync(storybookBin)) {
    throw new StorybrokrError(
      'HOST_INVALID',
      `${hostRoot} has no node_modules/.bin/storybook — install the host's dependencies first`,
    );
  }
  const pkgFile = join(hostRoot, 'node_modules', 'storybook', 'package.json');
  const storybookVersion = existsSync(pkgFile)
    ? (JSON.parse(readFileSync(pkgFile, 'utf8')) as { version: string }).version
    : 'unknown';
  if (storybookVersion !== 'unknown') {
    const major = Number.parseInt(storybookVersion, 10);
    if (Number.isFinite(major) && major < MIN_STORYBOOK_MAJOR) {
      throw new StorybrokrError(
        'HOST_INVALID',
        `${hostRoot} runs storybook ${storybookVersion}; storybrokr needs ${MIN_STORYBOOK_MAJOR} or newer`,
      );
    }
  }
  return {
    hostRoot,
    storybookDir,
    mainFile,
    previewFile: firstExisting(storybookDir, 'preview', PREVIEW_EXTS),
    managerFile: firstExisting(storybookDir, 'manager', PREVIEW_EXTS),
    framework: detectFramework(readFileSync(mainFile, 'utf8')),
    storybookBin,
    storybookVersion,
    tsconfigPaths: readTsconfigPaths(hostRoot),
  };
}

/** Resolve the host for a component path; an explicit root wins over walking up. */
export function resolveHost(pathArg: string, explicitHostRoot?: string): HostInfo {
  if (explicitHostRoot) return inspectHost(resolve(explicitHostRoot));
  const start = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const root = findHostRoot(existsSync(start) ? start : dirname(start));
  if (!root) {
    throw new StorybrokrError('HOST_NOT_FOUND', `no .storybook/ directory above ${start}`);
  }
  return inspectHost(root);
}
