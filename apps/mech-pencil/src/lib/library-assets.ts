/**
 * Locate / copy the committed, theme-invariant HeroUI library.
 *
 * The HeroUI component layer (groups + previews + design-system +
 * catalog + mock skeletons) is byte-identical across every theme —
 * it's pure `$brand:` references (verified). So it's generated ONCE
 * by `mech-pencil build-library`, committed under the heroui
 * framework, and `bundle` REUSES it: only `brand.lib.pen` is
 * per-project (defaults + CLI overrides).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEROUI_LIBRARY_REL = 'src/frameworks/heroui/library';

/** Walk up from this module to the @ecruz165/mech-pencil package root. */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    try {
      if (JSON.parse(readFileSync(pkg, 'utf8')).name === '@ecruz165/mech-pencil') {
        return dir;
      }
    } catch {
      /* keep walking */
    }
  }
  throw new Error('mech-pencil: could not locate package root');
}

/** Absolute path of the committed static HeroUI library directory. */
export function libraryDir(): string {
  return join(packageRoot(), HEROUI_LIBRARY_REL);
}

export function libraryExists(): boolean {
  return existsSync(join(libraryDir(), 'design-system.lib.pen'));
}

/** Recursively copy the committed library tree into `dest`. */
export function copyLibrary(dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(libraryDir(), dest, { recursive: true });
}
