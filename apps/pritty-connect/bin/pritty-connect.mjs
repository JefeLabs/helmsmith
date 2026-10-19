#!/usr/bin/env node
// The connections view is an OpenTUI app and needs Bun's FFI. When not already under Bun,
// re-exec the bundle with the vendored `bun` dependency (falling back to a system Bun on PATH).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.versions.bun) {
  const require = createRequire(import.meta.url);
  let bun;
  try {
    bun = join(dirname(require.resolve('bun/package.json')), 'bin', 'bun.exe');
  } catch {
    bun = 'bun';
  }
  const entry = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const { status, error } = spawnSync(bun, [entry, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (error) {
    console.error('pritty-connect requires the Bun runtime — install it from https://bun.sh');
    process.exit(1);
  }
  process.exit(status ?? 1);
}

await import('../dist/cli.js');
