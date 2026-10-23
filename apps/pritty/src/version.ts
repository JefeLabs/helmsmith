import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The CLI's version comes from package.json, never a literal: changesets bumps package.json
// only, so a hard-coded string drifts on every release. Walk upward from this module's own
// file so it resolves the same from dist/ (built), src/ (`tsx src/cli.ts`) and the npm
// install layout — no package.json sits between this file and the package root.
// Same module as storybrokr's and workbrokr's src/version.ts.
function findPackageJson(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package.json not found above ${startDir}`);
    dir = parent;
  }
}

const pkgFile = findPackageJson(dirname(fileURLToPath(import.meta.url)));
export const VERSION: string = (JSON.parse(readFileSync(pkgFile, 'utf8')) as { version: string })
  .version;
