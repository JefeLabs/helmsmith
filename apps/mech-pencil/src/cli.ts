/**
 * mech-pencil CLI entry. Thin commander wiring — each verb's logic
 * lives in `src/commands/<verb>.ts`. Matches the per-verb-file pattern
 * used across the agentx-toolbox monorepo (CONVENTIONS.md).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '@ecruz165/cli-kit';
import { runBrand } from './commands/brand.ts';
import { runBuildLibrary } from './commands/build-library.ts';
import { runBundle } from './commands/bundle.ts';
import { runConnect } from './commands/connect.ts';
import { runGen } from './commands/gen-library.ts';
import { runInit } from './commands/init.ts';
import { runList } from './commands/list.ts';
import { runTheme } from './commands/theme.ts';
import { runValidate } from './commands/validate.ts';
import { DEFAULT_FRAMEWORK } from './frameworks/registry.ts';
import { banner } from './ui.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  for (let dir = __dirname, i = 0; i < 4; i++, dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === '@ecruz165/mech-pencil') return pkg.version as string;
    } catch {
      /* keep walking */
    }
  }
  return '0.0.0';
}

const version = readVersion();

// No `auth` wired: mech-pencil generates JSON locally and makes no
// agent calls. If an agent-assisted generator is added later, wire an
// AuthProvider here against @ecruz165/agent-auth (same pattern as pritty).
const { program } = createCli({
  name: 'mech-pencil',
  version,
  description: 'Generate a single-file Pencil .pen (tokens + components + mockups) from framework adapters',
});

program
  .command('init')
  .description('Generate one self-contained .pen (tokens + components + mockup screens)')
  .option('-f, --framework <id>', 'Framework adapter', DEFAULT_FRAMEWORK)
  .option('-d, --dir <path>', 'Output directory', '.')
  .action((opts: { framework: string; dir: string }) =>
    runInit({ framework: opts.framework, dir: opts.dir }),
  );

program
  .command('gen')
  .description('Alias of init — emit the single .pen document')
  .option('-f, --framework <id>', 'Framework adapter', DEFAULT_FRAMEWORK)
  .option('-d, --dir <path>', 'Output directory', '.')
  .option('-n, --name <name>', 'Document file name (without .pen)')
  .action((opts: { framework: string; dir: string; name?: string }) =>
    runGen({ framework: opts.framework, dir: opts.dir, name: opts.name }),
  );

program
  .command('brand <file>')
  .description('From a brand JSON, emit swappable brand.pen + design.pen (imports it)')
  .option('-f, --framework <id>', 'Framework adapter', DEFAULT_FRAMEWORK)
  .option('-d, --dir <path>', 'Output directory', '.')
  .option('--brand-name <name>', 'brand file name (without .pen)', 'brand')
  .option('--design-name <name>', 'design file name (without .pen)', 'design')
  .action(
    (
      file: string,
      opts: { framework: string; dir: string; brandName: string; designName: string },
    ) =>
      runBrand({
        file,
        framework: opts.framework,
        dir: opts.dir,
        brandName: opts.brandName,
        designName: opts.designName,
      }),
  );

program
  .command('bundle')
  .description('Emit the layered set: theme.lib.pen + groups/<category>.lib.pen + mocks/<name>.pen')
  .option('-a, --accent <color>', 'Accent color (hex or oklch())')
  .option('-b, --base <number>', 'Neutral gray-tint (HeroUI base; 0–0.02)')
  .option('--font <name>', 'Sans font family')
  .option('-r, --radius <preset>', 'none|extra-small|small|medium|large|extra-large')
  .option('--form-radius <preset>', 'Form-field radius preset')
  .option('-d, --dir <path>', 'Output directory', '.')
  .option('--regenerate', 'Rebuild every file from scratch (default reuses the committed library)')
  .action(
    (opts: {
      accent?: string;
      base?: string;
      font?: string;
      radius?: string;
      formRadius?: string;
      dir: string;
      regenerate?: boolean;
    }) =>
      runBundle({
        accent: opts.accent,
        base: opts.base,
        font: opts.font,
        radius: opts.radius,
        formRadius: opts.formRadius,
        dir: opts.dir,
        regenerate: opts.regenerate,
      }),
  );

program
  .command('build-library')
  .description('MAINTAINER: regenerate the committed HeroUI library (run when components change)')
  .action(() => runBuildLibrary());

program
  .command('theme')
  .description('Generate a .pen themed via HeroUI Themes knobs (accent/base/font/radius)')
  .option('-a, --accent <color>', 'Accent color (hex or oklch())')
  .option('-b, --base <number>', 'Neutral gray-tint (HeroUI base; 0–0.02)')
  .option('--font <name>', 'Sans font family (inter, instrument-sans, …)')
  .option('-r, --radius <preset>', 'none|extra-small|small|medium|large|extra-large')
  .option('--form-radius <preset>', 'Form-field radius preset')
  .option('-d, --dir <path>', 'Output directory', '.')
  .option('-n, --name <name>', 'Document file name (without .pen)')
  .action(
    (opts: {
      accent?: string;
      base?: string;
      font?: string;
      radius?: string;
      formRadius?: string;
      dir: string;
      name?: string;
    }) =>
      runTheme({
        accent: opts.accent,
        base: opts.base,
        font: opts.font,
        radius: opts.radius,
        formRadius: opts.formRadius,
        dir: opts.dir,
        name: opts.name,
      }),
  );

program
  .command('list')
  .description('List frameworks, or one framework’s atomic component catalog')
  .option('-f, --framework <id>', 'Show this framework’s component catalog')
  .action((opts: { framework?: string }) => runList({ framework: opts.framework }));

program
  .command('validate <file>')
  .description('Structurally validate a .pen document (schema v2.11)')
  .action((file: string) => runValidate(file));

program
  .command('connect')
  .description('Open the interactive connections view (TUI)')
  .action(() => runConnect());

if (process.argv.length <= 2) {
  banner(version);
  process.exit(0);
}

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
