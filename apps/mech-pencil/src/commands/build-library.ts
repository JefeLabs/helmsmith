/**
 * `mech-pencil build-library` — MAINTAINER command.
 *
 * Regenerates the committed, theme-invariant HeroUI library under
 * `src/frameworks/heroui/library/` (groups + previews +
 * design-system + catalog + mock skeletons). Run this only when the
 * component catalog changes — NOT per project. Per-project theming is
 * just `design-tokens.lib.pen` (see `bundle`).
 *
 * Tokens are framework-specific: this library is HeroUI's, referencing
 * HeroUI's `$tokens:` token contract.
 */

import { join } from 'node:path';
import { emitBundle } from '../emit/bundle.ts';
import { libraryDir } from '../lib/library-assets.ts';
import { writeText } from '../lib/workspace.ts';
import { resolveTheme } from '../theme/config.ts';
import { dim, err, heading, ok } from '../ui.ts';

export function runBuildLibrary(): void {
  // Theme is irrelevant to the component files (verified byte-invariant);
  // use defaults. We DO commit a default `design-tokens.lib.pen` too so the
  // committed previews/aggregate resolve their `$tokens:` refs when
  // opened in place. `bundle` copies everything, then overwrites
  // design-tokens.lib.pen with the project's resolved (defaults + overrides) one.
  const b = emitBundle(resolveTheme({}));
  const files = [
    b.brand, // default design-tokens.lib.pen — makes committed previews viewable
    b.designSystem,
    b.designSystem.preview,
    ...b.groups,
    ...b.groups.map((g) => g.preview),
    ...b.mocks,
  ];

  const invalid = files.filter((f) => !f.validation.ok);
  if (invalid.length > 0) {
    for (const f of invalid) console.error(err(`${f.path} invalid`));
    process.exitCode = 1;
    return;
  }

  const dir = libraryDir();
  for (const f of files) writeText(join(dir, f.path), f.doc.toJSON());

  console.log(heading('HeroUI library rebuilt (committed, theme-invariant)'));
  console.log(ok(dir));
  console.log(
    dim(
      `  ${b.groups.length} categories (.lib + .preview) · design-system · catalog · ${b.mocks.length} mock(s)`,
    ),
  );
  console.log(dim('  commit this; `bundle` reuses it (only design-tokens.lib.pen is per-project).'));
}
