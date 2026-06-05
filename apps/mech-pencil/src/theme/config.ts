/**
 * Theme configuration — the HeroUI Themes builder knobs, collapsed to
 * the five inputs the user drives:
 *
 *   accent      a color (hex / oklch) → OKLCH lightness+chroma+hue
 *   base        neutral gray-tint (OKLCH chroma injected into neutrals)
 *   fontFamily  sans font
 *   radius      global corner radius preset
 *   formRadius  form-field corner radius preset
 *
 * (HeroUI's URL splits accent into lightness/chroma/hue; we accept one
 * color and derive those — see theme/generate.ts.)
 */

export type RadiusId =
  | 'none'
  | 'extra-small'
  | 'small'
  | 'medium'
  | 'large'
  | 'extra-large';

/** HeroUI `radiusCssMap`: preset → rem (verbatim from the builder). */
export const RADIUS_REM: Record<RadiusId, number> = {
  none: 0,
  'extra-small': 0.125,
  small: 0.25,
  medium: 0.5,
  large: 0.75,
  'extra-large': 1,
};

export const RADIUS_IDS = Object.keys(RADIUS_REM) as RadiusId[];

export interface ThemeConfig {
  /** Accent color (hex `#rrggbb` or `oklch(L C H)`). */
  accent: string;
  /** Neutral gray-tint = HeroUI `base`/grayChroma. Presets 0–0.02. */
  base: number;
  /** Sans font family display name. */
  fontFamily: string;
  /** Global corner-radius preset. */
  radius: RadiusId;
  /** Form-field corner-radius preset. */
  formRadius: RadiusId;
}

/** HeroUI `default` preset (accent = oklch(0.6204 0.195 253.83)). */
export const DEFAULT_THEME: ThemeConfig = {
  accent: 'oklch(62.04% 0.195 253.83)',
  base: 0.0015,
  fontFamily: 'Inter',
  radius: 'medium',
  formRadius: 'large',
};

const FONT_NAMES: Record<string, string> = {
  inter: 'Inter',
  'instrument-sans': 'Instrument Sans',
  geist: 'Geist',
  satoshi: 'Satoshi',
};

/** Normalize a partial CLI input into a complete, validated config. */
export function resolveTheme(input: Partial<ThemeConfig>): ThemeConfig {
  const radius = (input.radius ?? DEFAULT_THEME.radius) as RadiusId;
  const formRadius = (input.formRadius ?? DEFAULT_THEME.formRadius) as RadiusId;
  for (const [label, r] of [
    ['radius', radius],
    ['form-radius', formRadius],
  ] as const) {
    if (!(r in RADIUS_REM)) {
      throw new Error(
        `theme: invalid ${label} "${r}" — one of ${RADIUS_IDS.join(', ')}`,
      );
    }
  }
  const base = input.base ?? DEFAULT_THEME.base;
  if (Number.isNaN(base) || base < 0) {
    throw new Error(`theme: base must be a number ≥ 0 (got ${input.base})`);
  }
  const fontKey = (input.fontFamily ?? DEFAULT_THEME.fontFamily).toLowerCase();
  return {
    accent: input.accent ?? DEFAULT_THEME.accent,
    base,
    fontFamily: FONT_NAMES[fontKey] ?? input.fontFamily ?? DEFAULT_THEME.fontFamily,
    radius,
    formRadius,
  };
}
