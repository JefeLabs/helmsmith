/**
 * Foundation registry + multi-alias token routing (option A).
 *
 * Each foundation becomes its own token `.lib.pen` under its own import alias.
 * A component or decision page references a token by its FULL key; the routing
 * here maps the key's first segment to the owning foundation's alias, so
 * `color.accent` → `$colors:color.accent`, `font.body-md.size` →
 * `$type:font.body-md.size`, `icon.sm` → `$icons:icon.sm`, and
 * `space.4`/`grid.gutter`/`radius.md` → `$grids:…`.
 */

import type { FoundationSpec, MockupContext } from '../_core/adapter.ts';
import { colorsFoundation } from './colors.ts';
import { gridsFoundation } from './grids.ts';
import { iconsFoundation } from './icons.ts';
import { typographyFoundation } from './typography.ts';

export interface FoundationDef {
  /** File slug → `<slug>.lib.pen` / `<slug>.preview.pen`. */
  slug: string;
  /** Import alias → `$<alias>:<key>`. */
  alias: string;
  /** Token-key first segments this foundation owns. */
  prefixes: string[];
  /** The decision-page spec. */
  spec: FoundationSpec;
}

export const FOUNDATIONS: FoundationDef[] = [
  { slug: 'colors', alias: 'colors', prefixes: ['color'], spec: colorsFoundation() },
  { slug: 'typography', alias: 'type', prefixes: ['font'], spec: typographyFoundation() },
  { slug: 'icons', alias: 'icons', prefixes: ['icon'], spec: iconsFoundation() },
  {
    slug: 'grids',
    alias: 'grids',
    prefixes: ['space', 'grid', 'radius', 'border', 'opacity', 'ring'],
    spec: gridsFoundation(),
  },
];

/** Foundation whose `prefixes` own this token-key's first segment (default: grids). */
const DEFAULT_ALIAS = 'grids';
export function aliasForKey(key: string): string {
  const seg = key.split('.')[0];
  return FOUNDATIONS.find((f) => f.prefixes.includes(seg))?.alias ?? DEFAULT_ALIAS;
}

/** Slug for an alias (e.g. `type` → `typography`), for building import paths. */
export function slugForAlias(alias: string): string | undefined {
  return FOUNDATIONS.find((f) => f.alias === alias)?.slug;
}

/**
 * Build context that routes every token ref to its foundation lib. Used by the
 * decision pages and (later) the component catalog so refs cross to the right
 * `.lib.pen`.
 */
export function multiAliasContext(): MockupContext {
  return {
    component: (id) => id,
    token: (key) => `$${aliasForKey(key)}:${key}`,
  };
}
