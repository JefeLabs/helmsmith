#!/usr/bin/env node
// Self-contained Bun launcher. @opentui needs Bun's FFI to render its TUI, so when
// this CLI isn't already running under Bun we re-exec the bundle with the vendored
// `bun` dependency — no global Bun required (falls back to a system Bun on PATH).
// Under Bun, fall through to the app entry directly.
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
    bun = 'bun'; // no vendored bun resolvable — try a system Bun on PATH
  }
  const entry = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  // --no-env-file / --config: Bun would otherwise auto-load `.env*` files and `bunfig.toml`
  // (including its `preload` scripts) from the *current directory*, which is routinely a
  // cloned repo — i.e. that repo's code would run. The package ships its own empty
  // bunfig.toml so Bun never looks in the cwd.
  const bunfig = fileURLToPath(new URL('../bunfig.toml', import.meta.url));
  const { status, error } = spawnSync(
    bun,
    ['--no-env-file', `--config=${bunfig}`, entry, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  if (error) {
    console.error('This CLI requires the Bun runtime — install it from https://bun.sh');
    process.exit(1);
  }
  process.exit(status ?? 1);
}

// Already running under Bun (e.g. `bun x`): Bun has read the cwd's bunfig.toml and .env
// before this file ran, and nothing here can undo that. The Node entry above is the guard.
await import('../dist/cli.js');
