import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { findPackageRoot } from './_shared/package-root.js';

export interface ServeOptions {
  port?: string;
  storage?: string;
}

/**
 * Run the skillzkit REST API locally. Defaults to fs:auto storage
 * against this repo. Spawns the bundled Bun runtime on
 * server/bun.ts (Bun is a dep) — opentui can run TS directly without
 * a build step.
 */
export function runServe(options: ServeOptions = {}): void {
  const packageRoot = findPackageRoot();
  const requireFromHere = createRequire(import.meta.url);
  const bunPkgJsonPath = requireFromHere.resolve('bun/package.json');
  const bunPkg = JSON.parse(readFileSync(bunPkgJsonPath, 'utf8'));
  const bunBinRel = typeof bunPkg.bin === 'string' ? bunPkg.bin : bunPkg.bin?.bun;
  if (!bunBinRel) {
    console.error('Could not resolve bundled Bun binary.');
    process.exit(1);
  }
  const bunBin = join(dirname(bunPkgJsonPath), bunBinRel);
  const serverEntry = join(packageRoot, 'server', 'bun.ts');
  if (!existsSync(serverEntry)) {
    console.error(`Server entry not found at ${serverEntry}.`);
    process.exit(1);
  }
  const result = spawnSync(bunBin, [serverEntry], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SKILLZKIT_STORAGE: options.storage ?? process.env.SKILLZKIT_STORAGE ?? 'fs:auto',
      PORT: options.port ?? process.env.PORT ?? '3000',
    },
  });
  process.exit(result.status ?? 1);
}
