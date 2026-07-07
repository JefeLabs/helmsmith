import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Find the skillzkit package root by walking up looking for
 * catalog.json. Handles both compiled (`dist/bin/cli.js`) and source
 * (`bin/cli.ts` via tsx) layouts. Used by every command that needs
 * to read package-relative files (TAGS.md, .claude/, server/bun.ts).
 *
 * Memoized — every command calls this and the answer is stable for
 * the lifetime of the process.
 */
let cached: string | undefined;

export function findPackageRoot(): string {
  if (cached) return cached;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'catalog.json'))) {
      cached = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`skillzkit package root not found searching upward from ${__dirname}`);
}
