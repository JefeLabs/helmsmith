/**
 * `mech-pencil system` — emit the full option-A system to disk:
 *   foundations/<slug>.lib.pen   per-foundation token libs
 *   components/<cat>.lib.pen      per-category component libs (import foundations)
 *   templates/<slug>.lib.pen      page templates × viewports
 *   base.pen                      imports everything + demo pages
 * Each artifact gets a faithful PNG via Pencil's headless export (zero LLM).
 * Deterministic; PNGs are auth-gated (skipped + warned if the CLI isn't
 * authenticated) so generation never hard-fails.
 */

import { resolve } from 'node:path';
import { emitSystem } from '../emit/system.ts';
import { renderSystemPngs, writeSystem } from '../emit/write.ts';
import { type RadiusId, resolveTheme } from '../theme/config.ts';
import { themeTokens } from '../theme/generate.ts';
import { dim, err, heading, ok, warn } from '../ui.ts';

export interface SystemCmdOptions {
  accent?: string;
  base?: string;
  font?: string;
  radius?: string;
  formRadius?: string;
  dir: string;
  /** Also render preview PNGs (headless Pencil export; off by default). */
  png?: boolean;
}

export function runSystem(options: SystemCmdOptions): void {
  let cfg: ReturnType<typeof resolveTheme>;
  try {
    cfg = resolveTheme({
      accent: options.accent,
      base: options.base !== undefined ? Number(options.base) : undefined,
      fontFamily: options.font,
      radius: options.radius as RadiusId | undefined,
      formRadius: options.formRadius as RadiusId | undefined,
    });
  } catch (e) {
    console.error(err((e as Error).message));
    process.exitCode = 1;
    return;
  }

  const tokens = themeTokens(cfg).tokens;
  const sys = emitSystem(tokens);

  // Refuse to write an invalid system.
  const invalid = [
    ...sys.foundations.flatMap((f) => [f.libValidation, f.previewValidation]),
    ...sys.components.map((c) => c.validation),
    ...sys.templates.map((t) => t.libValidation),
    sys.base.validation,
  ].filter((v) => !v.ok);
  if (invalid.length > 0) {
    console.error(err(`generated ${invalid.length} invalid document(s):`));
    for (const v of invalid) for (const i of v.issues) console.error(dim(`  ${i.path}: ${i.message}`));
    process.exitCode = 1;
    return;
  }

  const dir = resolve(options.dir);
  const res = writeSystem(sys, dir);

  console.log(heading('HeroUI v3 → option-A system'));
  console.log(ok(`${dir}  (${res.files.length} files)`));
  console.log(
    dim(
      `  ${sys.foundations.length} foundations · ${sys.components.length} component libs · ${sys.templates.length} templates · base.pen`,
    ),
  );

  // PNG previews are decoupled from the deterministic .pen emit above — opt in
  // with --png. The headless export is auth-gated and may render nothing.
  if (options.png) {
    const r = renderSystemPngs(sys, tokens, dir);
    console.log(ok(`${r.pngs.length} PNGs rendered (Pencil headless export)`));
    if (r.skippedPngs.length > 0) {
      console.log(warn(`${r.skippedPngs.length} PNGs skipped — e.g. ${r.skippedPngs[0]}`));
      console.log(dim('  run `pencil login` or set PENCIL_CLI_KEY to render PNGs.'));
    }
  } else {
    console.log(dim('  PNG previews skipped — re-run with --png to render (headless Pencil export).'));
  }
  console.log(dim('  base.pen imports the libs; open it in Pencil to view/edit.'));
}