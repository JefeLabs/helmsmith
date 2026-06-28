/**
 * Port of HeroUI v3's `generateThemeColors` (extracted from the live
 * Themes builder, Apache-2.0).
 *
 * For each neutral token: keep its anchor LIGHTNESS, rotate HUE to the
 * accent hue, and set CHROMA to `base` (×2 for muted/surface-class).
 * Accent comes straight from the input color's OKLCH L/C/H. Status
 * colors, primitives, backdrop, etc. are inherited from the static
 * HeroUI set (the builder doesn't expose them). The result is fed to
 * the shared `deriveTokens` engine, which runs the same `color-mix`
 * recipes used everywhere else.
 */

import { parseColor } from '../color/oklch.ts';
import { type DeriveResult, deriveTokens } from '../frameworks/heroui/derive.ts';
import { DARK_COLORS, LIGHT_COLORS, SCALARS } from '../frameworks/heroui/tokens.ts';
import { RADIUS_REM, type ThemeConfig } from './config.ts';

interface Anchor {
  l: number;
  /** chroma multiplier of `base` (1 or 2). */
  m: 1 | 2;
}

/** Anchor lightness + base-multiplier per neutral, per mode (verbatim). */
const LIGHT_ANCHORS: Record<string, Anchor> = {
  background: { l: 0.9702, m: 1 },
  foreground: { l: 0.2103, m: 1 },
  default: { l: 0.94, m: 1 },
  muted: { l: 0.5517, m: 2 },
  surface: { l: 1, m: 2 },
  overlay: { l: 1, m: 2 },
  border: { l: 0.9, m: 2 },
  separator: { l: 0.92, m: 2 },
  scrollbar: { l: 0.871, m: 2 },
  segment: { l: 1, m: 2 },
  'surface-secondary': { l: 0.9524, m: 2 },
  'surface-tertiary': { l: 0.9373, m: 2 },
};
const DARK_ANCHORS: Record<string, Anchor> = {
  background: { l: 0.12, m: 1 },
  foreground: { l: 0.9911, m: 1 },
  default: { l: 0.274, m: 1 },
  muted: { l: 0.705, m: 2 },
  surface: { l: 0.2103, m: 2 },
  overlay: { l: 0.2103, m: 2 },
  border: { l: 0.28, m: 2 },
  separator: { l: 0.25, m: 2 },
  scrollbar: { l: 0.705, m: 2 },
  segment: { l: 0.3964, m: 2 },
  'surface-secondary': { l: 0.257, m: 2 },
  'surface-tertiary': { l: 0.2721, m: 2 },
};

const okl = (l: number, c: number, h: number) =>
  `oklch(${(l * 100).toFixed(2)}% ${Math.max(0, c).toFixed(4)} ${h.toFixed(2)})`;

/** Extract OKLCH lightness/chroma/hue from any parseable color. */
function accentLCH(color: string): { L: number; C: number; H: number } {
  const lab = parseColor(color);
  return {
    L: lab.L,
    C: Math.hypot(lab.a, lab.b),
    H: (((Math.atan2(lab.b, lab.a) * 180) / Math.PI) % 360 + 360) % 360,
  };
}

function neutralsFor(
  anchors: Record<string, Anchor>,
  base: number,
  hue: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, a] of Object.entries(anchors)) {
    out[name] = okl(a.l, base * a.m, hue);
  }
  return out;
}

export function themeTokens(cfg: ThemeConfig): DeriveResult {
  const { L, C, H } = accentLCH(cfg.accent);
  const accent = okl(L, C, H);
  // HeroUI `m()`: light accents get a dark fg, dark accents get snow.
  const accentFg =
    L > 0.65 ? okl(0.15, Math.min(0.2 * C, 0.03), H) : 'oklch(99.11% 0 0)';

  const build = (
    anchors: Record<string, Anchor>,
    staticBase: Record<string, string>,
    defaultFg: string,
  ): Record<string, string> => {
    const n = neutralsFor(anchors, cfg.base, H);
    return {
      ...staticBase, // status colors, primitives, backdrop, field-border…
      ...n,
      accent,
      'accent-foreground': accentFg,
      focus: accent,
      link: n.foreground,
      'surface-foreground': n.foreground,
      'overlay-foreground': n.foreground,
      'segment-foreground': n.foreground,
      'field-background': n.surface,
      'field-foreground': n.foreground,
      'field-placeholder': n.muted,
      'default-foreground': defaultFg,
    };
  };

  const light = build(LIGHT_ANCHORS, LIGHT_COLORS, okl(0.2103, 0.0059, H));
  const dark = build(
    DARK_ANCHORS,
    { ...LIGHT_COLORS, ...DARK_COLORS },
    'oklch(99.11% 0 0)',
  );

  // Scalars: radius scale from the preset (HeroUI calc() chain),
  // field radius from formRadius, font family; rest inherited.
  const r = RADIUS_REM[cfg.radius];
  const fieldR = RADIUS_REM[cfg.formRadius];
  const px = (rem: number) => Math.round(rem * 16);
  const radiusScale: Record<string, number> = {
    'radius.base': px(r),
    'radius.xs': px(r * 0.25),
    'radius.sm': px(r * 0.5),
    'radius.md': px(r * 0.75),
    'radius.lg': px(r),
    'radius.xl': px(r * 1.5),
    'radius.2xl': px(r * 2),
    'radius.3xl': px(r * 3),
    'radius.4xl': px(r * 4),
    'radius.field': px(fieldR),
  };
  const scalars = SCALARS.map((s) =>
    s.key in radiusScale
      ? { ...s, value: radiusScale[s.key] }
      : s.key === 'font.family'
        ? { ...s, value: cfg.fontFamily }
        : s,
  );

  return deriveTokens(light, dark, scalars);
}
