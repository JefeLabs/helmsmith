/**
 * Framework-agnostic token model.
 *
 * A `FrameworkAdapter` produces a `TokenSet`; `emit/library.ts` turns
 * it into the `.pen` `variables` + `themes` block. Keeping this neutral
 * (not HeroUI-shaped) is what lets a second framework adapter slot in
 * later without touching the emitter.
 *
 * Color tokens are theme-aware (light/dark). Scalars (radius, spacing,
 * border width, font size) are theme-flat in HeroUI v3 — the spec
 * allows per-theme scalars too, so the shape leaves room for it.
 */

export type ThemeMode = 'light' | 'dark';

/** Dotted key, referenced in nodes as `"$<key>"` (e.g. `$color.accent`). */
export type TokenKey = string;

export interface ColorToken {
  key: TokenKey;
  /** Resolved, static value per theme mode (hex, `#RRGGBB[AA]`). */
  values: Record<ThemeMode, string>;
}

export interface ScalarToken {
  key: TokenKey;
  type: 'number' | 'string';
  value: number | string;
}

export interface TokenSet {
  /** Theme axes to declare on the document, e.g. `mode: [light, dark]`. */
  axes: { axis: string; values: string[] }[];
  colors: ColorToken[];
  scalars: ScalarToken[];
}

/** `"$color.accent"` — the reference form used inside node props. */
export function tokenRef(key: TokenKey): string {
  return `$${key}`;
}
