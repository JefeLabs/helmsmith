import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsup builds this module into two separate entry bundles that sit at different depths under
// the package root — dist/cli.js (one level down) and, via server/daemon.ts, dist/server/
// start.js (two levels down) — so a single relative '../package.json' can't reach it from
// both. Walk upward from this module's own file instead; that also covers `tsx src/cli.ts` /
// dev imports, since no package.json sits between src/ (or src/server/) and the package root.
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
