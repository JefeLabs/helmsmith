/**
 * Theme contract — the shape every theme must conform to.
 *
 * Composition: palette (16 base16 colors) → semantic colors → typography
 * + spacing + borders + per-component variants/sizes. `defineTheme()`
 * runs that pipeline; this file just defines the shape.
 *
 * Token philosophy:
 *   - Colors live under `theme.colors.*` with intent-named slots
 *     (`primary`, `success`, `danger`) — components ask for the slot,
 *     theme resolves the actual color.
 *   - Spacing/borders/typography are scaler tokens — referenced by
 *     name (`md`, `lg`, `rounded`) so themes can swap.
 *   - Components carry their own variant/size dictionaries so the
 *     theme can change one component's look without touching others.
 */

export type ThemeAppearance = 'light' | 'dark';

// ────────────────────────────────────────────────────────────────────
// Base16 palette — the raw 16 colors a theme provides
// ────────────────────────────────────────────────────────────────────

/**
 * Base16 palette. Conventions follow the standard base16 spec:
 *   base00 — default background
 *   base01 — lighter background (status bars, panels)
 *   base02 — selection / highlight background
 *   base03 — comments, invisibles
 *   base04 — dark foreground (status bars)
 *   base05 — default foreground
 *   base06 — light foreground (rarely used)
 *   base07 — light background (rarely used)
 *   base08 — red    (errors, deletion)
 *   base09 — orange (numbers, constants)
 *   base0A — yellow (warnings, classes)
 *   base0B — green  (strings, success)
 *   base0C — cyan   (regex, escapes)
 *   base0D — blue   (functions, primary)
 *   base0E — purple (keywords, accent)
 *   base0F — brown  (deprecated, special)
 */
export interface Base16Palette {
  base00: string;
  base01: string;
  base02: string;
  base03: string;
  base04: string;
  base05: string;
  base06: string;
  base07: string;
  base08: string;
  base09: string;
  base0A: string;
  base0B: string;
  base0C: string;
  base0D: string;
  base0E: string;
  base0F: string;
}

// ────────────────────────────────────────────────────────────────────
// Semantic colors — what components actually consume
// ────────────────────────────────────────────────────────────────────

export interface SyntaxColors {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  type: string;
  variable: string;
  constant: string;
  operator: string;
  punctuation: string;
}

export interface ThemeColors {
  /** The raw 16-color palette this theme was built from. */
  palette: Base16Palette;

  // Surface
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  overlay: string;

  // Foreground
  text: string;
  textMuted: string;
  textSubtle: string;
  textInverted: string;

  // Intent
  primary: string;
  primaryFg: string;
  secondary: string;
  secondaryFg: string;
  accent: string;

  // Status
  success: string;
  successFg: string;
  warning: string;
  warningFg: string;
  danger: string;
  dangerFg: string;
  info: string;
  infoFg: string;

  // Code highlighting
  syntax: SyntaxColors;
}

// ────────────────────────────────────────────────────────────────────
// Spacing, borders, typography
// ────────────────────────────────────────────────────────────────────

export interface SpacingScale {
  none: 0;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export type SpacingKey = keyof SpacingScale;

export type BorderStyle = 'none' | 'single' | 'double' | 'rounded' | 'heavy';

export interface BorderTokens {
  default: BorderStyle;
  emphasis: BorderStyle;
  none: BorderStyle;
}

export type TypographyPreset =
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'caption'
  | 'code'
  | 'label';

export interface TypographyStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Foreground color slot or hex. */
  fg?: string;
}

export type Typography = Record<TypographyPreset, TypographyStyle>;

// ────────────────────────────────────────────────────────────────────
// Component variants/sizes
// ────────────────────────────────────────────────────────────────────

export interface BoxVariantStyle {
  bg?: string;
  fg?: string;
  border?: BorderStyle;
  borderColor?: string;
}

export interface TextVariantStyle {
  fg?: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  underline?: boolean;
}

export interface ButtonVariantStyle {
  bg: string;
  fg: string;
  borderColor: string;
  /** Background when the button has focus / is hovered. */
  bgFocus?: string;
  /** Foreground when the button has focus / is hovered. */
  fgFocus?: string;
}

export interface ButtonSizeStyle {
  paddingX: number;
  paddingY: number;
  minWidth: number;
}

export interface InputVariantStyle {
  bg: string;
  fg: string;
  borderColor: string;
  placeholderFg: string;
}

export interface BoxComponent {
  variants: {
    default: BoxVariantStyle;
    panel: BoxVariantStyle;
    overlay: BoxVariantStyle;
    transparent: BoxVariantStyle;
  };
}

export interface TextComponent {
  variants: {
    body: TextVariantStyle;
    muted: TextVariantStyle;
    subtle: TextVariantStyle;
    inverted: TextVariantStyle;
    accent: TextVariantStyle;
  };
}

export interface ButtonComponent {
  variants: {
    primary: ButtonVariantStyle;
    secondary: ButtonVariantStyle;
    ghost: ButtonVariantStyle;
    danger: ButtonVariantStyle;
    success: ButtonVariantStyle;
  };
  sizes: {
    sm: ButtonSizeStyle;
    md: ButtonSizeStyle;
    lg: ButtonSizeStyle;
  };
}

export interface InputComponent {
  variants: {
    default: InputVariantStyle;
    filled: InputVariantStyle;
    flushed: InputVariantStyle;
  };
}

export interface PanelComponent {
  /** Padding inside the panel. */
  padding: SpacingKey;
  /** Border style for the panel. */
  border: BorderStyle;
  /** Title-bar foreground. */
  titleFg: string;
  /** Title-bar background (often theme.colors.surface). */
  titleBg: string;
}

export interface ThemeComponents {
  box: BoxComponent;
  text: TextComponent;
  button: ButtonComponent;
  input: InputComponent;
  panel: PanelComponent;
}

// ────────────────────────────────────────────────────────────────────
// The Theme contract
// ────────────────────────────────────────────────────────────────────

export interface Theme {
  /** Stable id, e.g. `"rose-pine"`. */
  name: string;
  /** Human-readable name shown in the picker, e.g. `"Rosé Pine"`. */
  displayName: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  spacing: SpacingScale;
  borders: BorderTokens;
  typography: Typography;
  components: ThemeComponents;
}

// ────────────────────────────────────────────────────────────────────
// ThemeDefinition — input to defineTheme()
// ────────────────────────────────────────────────────────────────────

/**
 * Deep-partial — every field is optional, including nested ones.
 * Used by ThemeDefinition.overrides so theme authors only need to
 * declare what they actually customize.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object
    ? T[K] extends Array<unknown>
      ? T[K]
      : DeepPartial<T[K]>
    : T[K];
};

export interface ThemeDefinition {
  name: string;
  displayName: string;
  appearance: ThemeAppearance;
  palette: Base16Palette;
  /**
   * Override any computed token. Deep-merged onto the values
   * defineTheme() generates from the palette.
   */
  overrides?: DeepPartial<Omit<Theme, 'name' | 'displayName' | 'appearance'>>;
}
