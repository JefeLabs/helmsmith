#!/usr/bin/env node
// Self-contained Bun launcher. @opentui needs Bun's FFI to render its TUI, so when
// this CLI isn't already running under Bun we re-exec the bundle with the vendored
// `bun` dependency — no global Bun required.
// Under Bun, fall through to the app entry directly.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REINSTALL =
  'Reinstall timetracker so its `bun` dependency is present; installs with --ignore-scripts are unsupported.';

if (!process.versions.bun) {
  const require = createRequire(import.meta.url);
  // Only the vendored binary, by absolute path, and no fallback to a bare `bun`: that is
  // looked up through PATH (on Windows, in the current directory first), and this CLI is
  // routinely run inside cloned repos, which could plant one.
  let bun;
  try {
    bun = join(dirname(require.resolve('bun/package.json')), 'bin', 'bun.exe');
  } catch {
    console.error(`timetracker: the vendored Bun runtime is missing. ${REINSTALL}`);
    process.exit(1);
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
    console.error(
      `timetracker: could not run the vendored Bun at ${bun} (${error.code ?? error.message}). ${REINSTALL}`,
    );
    process.exit(1);
  }
  process.exit(status ?? 1);
}

// Already running under Bun (e.g. `bun x`): Bun has read the cwd's bunfig.toml and .env
// before this file ran, and nothing here can undo that. The Node entry above is the guard.
await import('../dist/cli.js');
