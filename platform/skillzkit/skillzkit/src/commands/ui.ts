import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SkillzkitApiError } from '../api/client.js';
import { configExists } from '../init/config.js';
import { runContribute } from '../init/contribute-flow.js';
import { runInit } from '../init/init.js';
import { closePrompts, prompt, promptHidden } from '../init/prompt.js';
import { gatherInitOptions } from './_shared/gather-init.js';
import { findPackageRoot } from './_shared/package-root.js';
import { renderApiError } from './_shared/render-api-error.js';

export interface UiOptions {
  target?: string;
}

/**
 * Special exit code the TUI uses to signal "user requested
 * contribute mode." The `ui` action loops on this status: on each
 * 42, run the contribute prompts, then re-launch the TUI. Any
 * other non-zero status is a real exit / error.
 */
const TUI_EXIT_CONTRIBUTE = 42;

/**
 * Launch the interactive installer (requires bundled Bun runtime).
 *
 * First-run integration: if no config exists, walk the user through
 * `skillzkit init` interactively before spawning the TUI.
 *
 * Contribute integration: TUI exits with code 42 to signal "user
 * pressed n to contribute"; we run the contribute prompts and
 * re-launch the TUI. Loops until the user quits normally (status 0)
 * or hits an error.
 */
export async function runUi(options: UiOptions = {}): Promise<void> {
  if (!configExists()) {
    console.log('');
    console.log("First-time setup — let's configure skillzkit.");
    console.log('');
    try {
      const opts = await gatherInitOptions({});
      const result = runInit(opts);
      console.log(`\n✓ Created ${result.path}`);
      console.log(`  Mode: ${result.config.mode}`);
      console.log('');
      console.log('Launching skillzkit ui...');
      console.log('');
    } catch (err) {
      console.error(`\n✗ Setup failed: ${(err as Error).message}`);
      console.error('Run `skillzkit init` to retry.');
      process.exit(1);
    }
  }

  const targetDir = options.target ?? process.cwd();
  let status: number | null;
  do {
    status = launchTui(targetDir);
    if (status === TUI_EXIT_CONTRIBUTE) {
      await runContributeFromTui();
    }
  } while (status === TUI_EXIT_CONTRIBUTE);
  process.exit(status ?? 1);
}

/**
 * Launch the TUI by spawning the bundled Bun binary on the TUI
 * entry. Bun is required because @opentui/core uses Bun-native FFI;
 * it does not load under Node's ESM loader.
 *
 * Returns the TUI's exit code (or null if it terminated by signal).
 * The `ui` action loops on `TUI_EXIT_CONTRIBUTE` (42).
 */
function launchTui(targetDir: string): number | null {
  const packageRoot = findPackageRoot();
  const requireFromHere = createRequire(import.meta.url);
  const bunPkgJsonPath = requireFromHere.resolve('bun/package.json');
  const bunPkg = JSON.parse(readFileSync(bunPkgJsonPath, 'utf8'));
  const bunBinRel = typeof bunPkg.bin === 'string' ? bunPkg.bin : bunPkg.bin?.bun;
  if (!bunBinRel) {
    console.error('Could not resolve bundled Bun binary from package.json bin field.');
    process.exit(1);
  }
  const bunBin = join(dirname(bunPkgJsonPath), bunBinRel);
  // Installed, this module is bundled into dist/cli.js and the TUI is dist/tui.js (tsup entry
  // `tui`). Run from source (`bun src/cli.ts`), this module is a .ts file: use the TUI source.
  const tuiEntry = import.meta.url.endsWith('.ts')
    ? join(packageRoot, 'src', 'tui', 'main.tsx')
    : join(packageRoot, 'dist', 'tui.js');

  if (!existsSync(tuiEntry)) {
    console.error(
      `TUI entry not found at ${tuiEntry}. Reinstall skillzkit (in a checkout: pnpm build).`,
    );
    process.exit(1);
  }
  if (!existsSync(bunBin)) {
    console.error(`Bundled Bun binary not found at ${bunBin}.`);
    process.exit(1);
  }

  // --no-env-file / --config, as in bin/skillzkit.mjs: without them this Bun process reads
  // `.env*` and `bunfig.toml` (whose `preload` runs code) from the current directory, which
  // is routinely a cloned repo. The package's bunfig.toml is intentionally empty.
  const bunfig = join(packageRoot, 'bunfig.toml');
  const result = spawnSync(bunBin, ['--no-env-file', `--config=${bunfig}`, tuiEntry], {
    stdio: 'inherit',
    env: { ...process.env, SKILLZKIT_TARGET: targetDir },
  });
  return result.status;
}

/**
 * Run the contribute flow interactively after the TUI exits with
 * the contribute marker. Asks for the path, then delegates to
 * runContribute() which prompts for PIN and submits via the API.
 */
async function runContributeFromTui(): Promise<void> {
  console.log('');
  console.log('Contribute - submit a new artifact');
  console.log('');
  let inputPath: string;
  try {
    inputPath = (
      await prompt('Path to .md file (command/workflow) or skill directory (with SKILL.md): ')
    ).trim();
  } finally {
    closePrompts();
  }
  if (!inputPath) {
    console.log('Cancelled.');
    return;
  }
  try {
    const result = await runContribute({
      inputPath,
      pinProvider: () => promptHidden('PIN to decrypt API key (set during `skillzkit init`): '),
    });
    console.log('');
    console.log(`✓ Accepted ${result.kind}:${result.slug}@${result.version}`);
    console.log(`  Contribution id: ${result.id}`);
    console.log('');
    console.log('Press Enter to return to the catalog browser.');
    await prompt('');
    closePrompts();
  } catch (err) {
    if (err instanceof SkillzkitApiError) {
      renderApiError(err);
    } else {
      console.error(`✗ ${(err as Error).message}`);
    }
    console.log('');
    console.log('Press Enter to return to the catalog browser.');
    await prompt('');
    closePrompts();
  }
}
