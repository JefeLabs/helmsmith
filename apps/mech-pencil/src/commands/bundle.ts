/**
 * `mech-pencil bundle` — assemble a project bundle.
 *
 * Default (reuse): COPY the committed, theme-invariant HeroUI library
 * (`src/frameworks/heroui/library/` — groups + previews +
 * design-system + catalog + mock skeletons) into `<dir>`, then write
 * the ONLY per-project file, `<dir>/design-tokens.lib.pen` = HeroUI token
 * defaults overridden by the CLI knobs (accent/base/font/radius).
 *
 * `--regenerate`: rebuild every file from scratch (dev / when the
 * committed library is stale or missing). Same output, slower.
 *
 * Tokens are framework-specific: `design-tokens.lib.pen` is HeroUI's token
 * contract; the library references it via `$tokens:`.
 */

import { join, resolve } from 'node:path';
import { emitBundle } from '../emit/bundle.ts';
import { copyLibrary, libraryExists } from '../lib/library-assets.ts';
import { writeText } from '../lib/workspace.ts';
import { type ThemeConfig, resolveTheme } from '../theme/config.ts';
import { dim, err, heading, ok, warn } from '../ui.ts';

export interface BundleCmdOptions {
  accent?: string;
  base?: string;
  font?: string;
  radius?: string;
  formRadius?: string;
  dir: string;
  regenerate?: boolean;
}

function resolveCfg(o: BundleCmdOptions): ThemeConfig {
  return resolveTheme({
    accent: o.accent,
    base: o.base !== undefined ? Number(o.base) : undefined,
    fontFamily: o.font,
    radius: o.radius as ThemeConfig['radius'] | undefined,
    formRadius: o.formRadius as ThemeConfig['formRadius'] | undefined,
  });
}

export function runBundle(options: BundleCmdOptions): void {
  let cfg: ThemeConfig;
  try {
    cfg = resolveCfg(options);
  } catch (e) {
    console.error(err((e as Error).message));
    process.exitCode = 1;
    return;
  }

  const root = resolve(options.dir);
  const bundle = emitBundle(cfg);

  const themeLine = dim(
    `  accent ${cfg.accent} · base ${cfg.base} · ${cfg.fontFamily} · radius ${cfg.radius}/${cfg.formRadius}`,
  );

  // --- Full regenerate path (dev / bootstrap) -------------------------
  if (options.regenerate || !libraryExists()) {
    if (!options.regenerate) {
      console.log(warn('committed HeroUI library not found — regenerating from scratch.'));
    }
    const all = [
      bundle.brand,
      bundle.designSystem,
      bundle.designSystem.preview,
      ...bundle.groups,
      ...bundle.groups.map((g) => g.preview),
      ...bundle.mocks,
    ];
    const invalid = all.filter((f) => !f.validation.ok);
    if (invalid.length > 0) {
      for (const f of invalid) {
        console.error(err(`${f.path} invalid (${f.validation.issues.length}):`));
        for (const i of f.validation.issues) console.error(dim(`  ${i.path}: ${i.message}`));
      }
      process.exitCode = 1;
      return;
    }
    for (const f of all) writeText(join(root, f.path), f.doc.toJSON());
    console.log(heading('HeroUI v3 → layered bundle (regenerated)'));
    console.log(themeLine);
    console.log(ok(`${root}  ${dim(`${all.length} files`)}`));
    return;
  }

  // --- Reuse path (default) ------------------------------------------
  if (!bundle.brand.validation.ok) {
    console.error(err('design-tokens.lib.pen invalid:'));
    for (const i of bundle.brand.validation.issues) {
      console.error(dim(`  ${i.path}: ${i.message}`));
    }
    process.exitCode = 1;
    return;
  }
  copyLibrary(root); // committed HeroUI layer — theme-invariant
  writeText(join(root, bundle.brand.path), bundle.brand.doc.toJSON());

  console.log(heading('HeroUI v3 → bundle (reused committed library)'));
  console.log(themeLine);
  console.log(ok(`${join(root, bundle.brand.path)}  ${dim('per-project (defaults + your overrides)')}`));
  console.log(
    dim(`  + reused committed library: ${bundle.groups.length} categories (.lib+.preview) · design-system · catalog · mocks`),
  );
  console.log(dim('  open design-system.preview.pen / groups/*.preview.pen / mocks/*.pen to view themed.'));
}
