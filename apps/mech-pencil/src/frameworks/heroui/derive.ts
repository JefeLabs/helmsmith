/**
 * Resolve HeroUI v3 raw token data → a static, theme-aware `TokenSet`.
 *
 *   1. Flatten primitives + base colors per mode (dark inherits light).
 *   2. Resolve primitive aliases (`foreground: "eclipse"`).
 *   3. Resolve every `DERIVED` recipe via `mixOklab` (the contribution
 *      point). If that's not implemented yet, we degrade gracefully:
 *      emit base tokens only and report it, so the CLI still produces
 *      a usable library.
 */

import type { ThemeMode, TokenSet } from '../../design-system/tokens.ts';
import { ColorMixNotImplemented, mixOklab } from '../../color/mix.ts';
import { type Lab, parseColor, toHex } from '../../color/oklch.ts';
import {
  DARK_COLORS,
  DERIVED,
  LIGHT_COLORS,
  PRIMITIVES,
  SCALARS,
} from './tokens.ts';

const MODES: ThemeMode[] = ['light', 'dark'];

/** Resolve a raw value that may be a primitive alias or a base alias. */
function resolveRaw(name: string, base: Record<string, string>): string {
  const seen = new Set<string>();
  let cur = name;
  while (!seen.has(cur)) {
    seen.add(cur);
    if (PRIMITIVES[cur]) return PRIMITIVES[cur];
    const next = base[cur];
    if (next === undefined) return cur; // already a literal color string
    if (PRIMITIVES[next]) return PRIMITIVES[next];
    if (base[next] === undefined) return next; // literal
    cur = next;
  }
  return cur;
}

export interface DeriveResult {
  tokens: TokenSet;
  /** True when derived (hover/soft/border) tokens were resolved. */
  derivedResolved: boolean;
  /** Set when the color-mix contribution is still a stub. */
  note?: string;
}

type ScalarList = { key: string; type: 'number' | 'string'; value: number | string }[];

/**
 * Generic engine: given per-mode base color maps (name → color string,
 * primitive aliases allowed) and a scalar list, parse, run every
 * `DERIVED` color-mix recipe via `mixOklab`, and emit a `TokenSet`.
 * Both static HeroUI and the HeroUI Themes generator feed this.
 */
export function deriveTokens(
  baseLight: Record<string, string>,
  baseDark: Record<string, string>,
  scalarList: ScalarList,
): DeriveResult {
  const baseByMode: Record<ThemeMode, Record<string, string>> = {
    light: baseLight,
    dark: baseDark,
  };

  // Parse every base color name into Lab, per mode.
  const labByMode: Record<ThemeMode, Map<string, Lab>> = {
    light: new Map(),
    dark: new Map(),
  };
  for (const mode of MODES) {
    const base = baseByMode[mode];
    for (const name of Object.keys(base)) {
      labByMode[mode].set(name, parseColor(resolveRaw(name, base)));
    }
  }

  const colors: TokenSet['colors'] = [];
  for (const name of Object.keys(baseLight)) {
    colors.push({
      key: `color.${name}`,
      values: {
        light: toHex(labByMode.light.get(name) as Lab),
        dark: toHex(labByMode.dark.get(name) as Lab),
      },
    });
  }

  let derivedResolved = true;
  let note: string | undefined;
  try {
    for (const r of DERIVED) {
      const values = {} as Record<ThemeMode, string>;
      for (const mode of MODES) {
        const a = labByMode[mode].get(r.a) as Lab;
        const b =
          r.b === 'transparent'
            ? { L: 0, a: 0, b: 0, alpha: 0 }
            : (labByMode[mode].get(r.b) as Lab);
        values[mode] = toHex(mixOklab(a, b, r.weightA));
      }
      colors.push({ key: `color.${r.key}`, values });
    }
  } catch (err) {
    if (err instanceof ColorMixNotImplemented) {
      derivedResolved = false;
      note =
        'derived hover/soft/border tokens skipped — implement mixOklab() ' +
        'in src/color/mix.ts, then re-run to get the full palette.';
    } else {
      throw err;
    }
  }

  const scalars: TokenSet['scalars'] = scalarList.map((s) => ({
    key: s.key,
    type: s.type,
    value: s.value,
  }));

  return {
    tokens: {
      axes: [{ axis: 'mode', values: ['light', 'dark'] }],
      colors,
      scalars,
    },
    derivedResolved,
    note,
  };
}

/** Static HeroUI v3 default theme — the original behavior, unchanged. */
export function deriveHeroUITokens(): DeriveResult {
  return deriveTokens(LIGHT_COLORS, { ...LIGHT_COLORS, ...DARK_COLORS }, SCALARS);
}
