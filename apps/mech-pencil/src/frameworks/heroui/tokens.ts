/**
 * HeroUI v3 raw token data — transcribed verbatim from
 * @heroui/styles `themes/default/variables.css` + `shared/theme.css`.
 *
 * This file is *data only*: the raw `oklch(...)`/hex strings and the
 * `color-mix` recipes exactly as HeroUI authors them. `derive.ts`
 * resolves the recipes into static per-theme hex via the color engine.
 *
 * Dark only lists the variables HeroUI actually overrides; anything
 * absent inherits the light value (e.g. `accent`, `success`).
 */

/** Primitive colors — constant across light & dark. */
export const PRIMITIVES: Record<string, string> = {
  white: 'oklch(100% 0 0)',
  black: 'oklch(0% 0 0)',
  snow: 'oklch(0.9911 0 0)',
  eclipse: 'oklch(0.2103 0.0059 285.89)',
};

/** Base theme colors (light). Values may reference a primitive name. */
export const LIGHT_COLORS: Record<string, string> = {
  background: 'oklch(0.9702 0 0)',
  foreground: 'eclipse',
  surface: 'white',
  'surface-foreground': 'foreground',
  'surface-secondary': 'oklch(0.9524 0.0013 286.37)',
  'surface-tertiary': 'oklch(0.9373 0.0013 286.37)',
  overlay: 'white',
  'overlay-foreground': 'foreground',
  muted: 'oklch(0.5517 0.0138 285.94)',
  scrollbar: 'oklch(87.1% 0.006 286.286)',
  default: 'oklch(94% 0.001 286.375)',
  'default-foreground': 'eclipse',
  accent: 'oklch(0.6204 0.195 253.83)',
  'accent-foreground': 'snow',
  'field-background': 'white',
  'field-foreground': 'oklch(0.2103 0.0059 285.89)',
  'field-placeholder': 'muted',
  'field-border': 'transparent',
  success: 'oklch(0.7329 0.1935 150.81)',
  'success-foreground': 'eclipse',
  warning: 'oklch(0.7819 0.1585 72.33)',
  'warning-foreground': 'eclipse',
  danger: 'oklch(0.6532 0.2328 25.74)',
  'danger-foreground': 'snow',
  segment: 'white',
  'segment-foreground': 'eclipse',
  border: 'oklch(90% 0.004 286.32)',
  separator: 'oklch(92% 0.004 286.32)',
  focus: 'accent',
  link: 'foreground',
  backdrop: 'rgba(0, 0, 0, 0.5)',
};

/** Dark overrides only. Absent keys inherit `LIGHT_COLORS`. */
export const DARK_COLORS: Record<string, string> = {
  background: 'oklch(12% 0.005 285.823)',
  foreground: 'snow',
  surface: 'oklch(0.2103 0.0059 285.89)',
  'surface-secondary': 'oklch(0.257 0.0037 286.14)',
  'surface-tertiary': 'oklch(0.2721 0.0024 247.91)',
  overlay: 'oklch(0.2103 0.0059 285.89)',
  muted: 'oklch(70.5% 0.015 286.067)',
  scrollbar: 'oklch(70.5% 0.015 286.067)',
  default: 'oklch(27.4% 0.006 286.033)',
  'default-foreground': 'snow',
  'field-background': 'oklch(0.2103 0.0059 285.89)',
  'field-foreground': 'foreground',
  warning: 'oklch(0.8203 0.1388 76.34)',
  'warning-foreground': 'eclipse',
  danger: 'oklch(0.594 0.1967 24.63)',
  'danger-foreground': 'snow',
  segment: 'oklch(0.3964 0.01 285.93)',
  'segment-foreground': 'foreground',
  border: 'oklch(28% 0.006 286.033)',
  separator: 'oklch(25% 0.006 286.033)',
  backdrop: 'rgba(0, 0, 0, 0.6)',
};

/**
 * Calculated/derived colors. Each is `color-mix(in oklab, <a> wA%,
 * <b> (100-wA)%)` where `a`/`b` are resolved within the *same* theme.
 * `weightA` is the share of `a` (HeroUI's first percentage / 100).
 *
 * `soft` variants mix toward `transparent` → pre-resolved to the base
 * color at the corresponding alpha.
 */
export interface DerivedRecipe {
  key: string;
  a: string;
  b: string;
  weightA: number;
}

export const DERIVED: DerivedRecipe[] = [
  { key: 'surface-hover', a: 'surface', b: 'surface-foreground', weightA: 0.92 },
  { key: 'background-secondary', a: 'background', b: 'foreground', weightA: 0.96 },
  { key: 'background-tertiary', a: 'background', b: 'foreground', weightA: 0.92 },
  { key: 'default-hover', a: 'default', b: 'default-foreground', weightA: 0.96 },
  { key: 'accent-hover', a: 'accent', b: 'accent-foreground', weightA: 0.9 },
  { key: 'success-hover', a: 'success', b: 'success-foreground', weightA: 0.9 },
  { key: 'warning-hover', a: 'warning', b: 'warning-foreground', weightA: 0.9 },
  { key: 'danger-hover', a: 'danger', b: 'danger-foreground', weightA: 0.9 },
  { key: 'accent-soft', a: 'accent', b: 'transparent', weightA: 0.15 },
  { key: 'success-soft', a: 'success', b: 'transparent', weightA: 0.15 },
  { key: 'warning-soft', a: 'warning', b: 'transparent', weightA: 0.15 },
  { key: 'danger-soft', a: 'danger', b: 'transparent', weightA: 0.15 },
  { key: 'accent-soft-hover', a: 'accent', b: 'transparent', weightA: 0.2 },
  { key: 'separator-secondary', a: 'surface', b: 'surface-foreground', weightA: 0.85 },
  { key: 'separator-tertiary', a: 'surface', b: 'surface-foreground', weightA: 0.81 },
  { key: 'border-secondary', a: 'surface', b: 'surface-foreground', weightA: 0.78 },
  { key: 'border-tertiary', a: 'surface', b: 'surface-foreground', weightA: 0.66 },
];

/** Non-color tokens. HeroUI v3 base `--radius` is 0.5rem; rem→px @16. */
export const SCALARS: { key: string; type: 'number' | 'string'; value: number | string }[] = [
  { key: 'space.unit', type: 'number', value: 4 },
  { key: 'radius.base', type: 'number', value: 8 },
  { key: 'radius.xs', type: 'number', value: 2 },
  { key: 'radius.sm', type: 'number', value: 4 },
  { key: 'radius.md', type: 'number', value: 6 },
  { key: 'radius.lg', type: 'number', value: 8 },
  { key: 'radius.xl', type: 'number', value: 12 },
  { key: 'radius.2xl', type: 'number', value: 16 },
  { key: 'radius.3xl', type: 'number', value: 24 },
  { key: 'radius.4xl', type: 'number', value: 32 },
  { key: 'radius.field', type: 'number', value: 12 },
  { key: 'border.width', type: 'number', value: 1 },
  { key: 'border.field-width', type: 'number', value: 0 },
  { key: 'opacity.disabled', type: 'number', value: 0.5 },
  { key: 'ring.offset-width', type: 'number', value: 2 },
  { key: 'font.family', type: 'string', value: 'Inter' },
  { key: 'font.size-sm', type: 'number', value: 14 },
  { key: 'font.size-md', type: 'number', value: 16 },
  { key: 'font.size-lg', type: 'number', value: 18 },
];
