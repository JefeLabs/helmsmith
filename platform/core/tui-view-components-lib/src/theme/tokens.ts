/**
 * `defineTheme()` — build a full Theme from a 16-color base16 palette
 * plus optional overrides.
 *
 * Pipeline: palette → semantic colors → typography presets →
 * component variants/sizes. Each step has sane defaults derived from
 * the base16 spec; authors can override anything via the
 * `overrides` field on ThemeDefinition.
 */

import { deepMerge } from './base16.ts';
import type {
  Base16Palette,
  ButtonComponent,
  DeepPartial,
  InputComponent,
  Theme,
  ThemeColors,
  ThemeComponents,
  ThemeDefinition,
  Typography,
} from './types.ts';

// ────────────────────────────────────────────────────────────────────
// palette → semantic colors
// ────────────────────────────────────────────────────────────────────

function deriveColors(p: Base16Palette): ThemeColors {
  return {
    palette: p,

    // Surface
    background: p.base00,
    surface: p.base01,
    surfaceMuted: p.base02,
    border: p.base03,
    overlay: p.base01,

    // Foreground
    text: p.base05,
    textMuted: p.base04,
    textSubtle: p.base03,
    textInverted: p.base00,

    // Intent — base0D is the canonical "primary" slot in base16
    primary: p.base0D,
    primaryFg: p.base00,
    secondary: p.base0E,
    secondaryFg: p.base00,
    accent: p.base0E,

    // Status
    success: p.base0B,
    successFg: p.base00,
    warning: p.base0A,
    warningFg: p.base00,
    danger: p.base08,
    dangerFg: p.base00,
    info: p.base0C,
    infoFg: p.base00,

    // Syntax — based on base16 spec slot meanings
    syntax: {
      comment: p.base03,
      keyword: p.base0E,
      string: p.base0B,
      number: p.base09,
      function: p.base0D,
      type: p.base0A,
      variable: p.base05,
      constant: p.base09,
      operator: p.base05,
      punctuation: p.base05,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Typography defaults
// ────────────────────────────────────────────────────────────────────

function defaultTypography(c: ThemeColors): Typography {
  return {
    title: { bold: true, fg: c.primary },
    heading: { bold: true, fg: c.text },
    subheading: { bold: true, fg: c.textMuted },
    body: { fg: c.text },
    caption: { fg: c.textMuted, italic: true },
    code: { fg: c.syntax.string },
    label: { bold: true, fg: c.textMuted },
  };
}

// ────────────────────────────────────────────────────────────────────
// Component defaults
// ────────────────────────────────────────────────────────────────────

const BUTTON_SIZES: ButtonComponent['sizes'] = {
  sm: { paddingX: 1, paddingY: 0, width: 14, minWidth: 6 },
  md: { paddingX: 2, paddingY: 0, width: 16, minWidth: 10 },
  lg: { paddingX: 3, paddingY: 1, width: 20, minWidth: 14 },
} as const;

function defaultButton(c: ThemeColors): ButtonComponent {
  // Canonical design: every variant is an OUTLINED button at rest —
  // intent-colored border + intent-colored text + transparent (page-bg)
  // interior. Every variant has the identical silhouette (thin frame
  // around a 1-cell interior), so visual weight is uniform across the
  // row regardless of which variant you pick.
  //
  // The "filled" look is reserved for state changes:
  //   selected → variant's intent color fills the bg (persistent)
  //   focused  → accent shade fills the bg (transient, follows cursor)
  // When both apply, focused wins.
  //
  // Two axes, orthogonal:
  //   variant  → color (primary/secondary/ghost/danger/success)
  //   state    → silhouette (outlined / filled-active / filled-focused)
  return {
    variants: {
      primary: {
        bg: c.background,
        fg: c.primary,
        borderColor: c.primary,
        bgActive: c.primary,
        fgActive: c.primaryFg,
        bgFocus: c.accent,
        fgFocus: c.primaryFg,
      },
      secondary: {
        bg: c.background,
        fg: c.text,
        borderColor: c.border,
        bgActive: c.surfaceMuted,
        fgActive: c.text,
        bgFocus: c.border,
        fgFocus: c.text,
      },
      ghost: {
        // Subtler than secondary: dimmer fg, same neutral border.
        // Use for tertiary actions that should be discoverable but not
        // compete visually with primary/secondary.
        bg: c.background,
        fg: c.textMuted,
        borderColor: c.border,
        bgActive: c.surface,
        fgActive: c.text,
        bgFocus: c.surfaceMuted,
        fgFocus: c.text,
      },
      danger: {
        bg: c.background,
        fg: c.danger,
        borderColor: c.danger,
        bgActive: c.danger,
        fgActive: c.dangerFg,
        bgFocus: c.danger,
        fgFocus: c.dangerFg,
      },
      success: {
        bg: c.background,
        fg: c.success,
        borderColor: c.success,
        bgActive: c.success,
        fgActive: c.successFg,
        bgFocus: c.success,
        fgFocus: c.successFg,
      },
    },
    sizes: cloneSizes(BUTTON_SIZES),
  };
}

function cloneSizes(sizes: ButtonComponent['sizes']): ButtonComponent['sizes'] {
  return {
    sm: { ...sizes.sm },
    md: { ...sizes.md },
    lg: { ...sizes.lg },
  };
}

function defaultInput(c: ThemeColors): InputComponent {
  return {
    variants: {
      default: {
        bg: c.background,
        fg: c.text,
        borderColor: c.border,
        placeholderFg: c.textSubtle,
      },
      filled: {
        bg: c.surface,
        fg: c.text,
        borderColor: c.surface,
        placeholderFg: c.textSubtle,
      },
      flushed: {
        // Match Panel's surface so flushed inputs visually inherit their
        // container (the most common case). openTUI's <input> can't be
        // truly transparent — its renderable always paints something — so
        // we pick the bg that most often blends in.
        bg: c.surface,
        fg: c.text,
        borderColor: c.surface,
        placeholderFg: c.textSubtle,
      },
    },
  };
}

function defaultComponents(c: ThemeColors): ThemeComponents {
  return {
    box: {
      variants: {
        default: { bg: c.background, fg: c.text, border: 'none' },
        panel: {
          bg: c.surface,
          fg: c.text,
          border: 'single',
          borderColor: c.border,
        },
        overlay: {
          bg: c.overlay,
          fg: c.text,
          border: 'single',
          borderColor: c.accent,
        },
        transparent: { border: 'none' },
      },
    },
    text: {
      variants: {
        body: { fg: c.text },
        muted: { fg: c.textMuted },
        subtle: { fg: c.textSubtle, dim: true },
        inverted: { fg: c.textInverted },
        accent: { fg: c.accent },
      },
    },
    button: defaultButton(c),
    input: defaultInput(c),
    panel: {
      padding: 'md',
      border: 'single',
      titleFg: c.primary,
      titleBg: c.surface,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// defineTheme — public entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Build a Theme from a base16 palette plus optional overrides.
 * Every field is computed from the palette using the base16 slot
 * conventions; overrides deep-merge on top.
 */
export function defineTheme(def: ThemeDefinition): Theme {
  const colors = deriveColors(def.palette);
  const baseTheme: Omit<Theme, 'name' | 'displayName' | 'appearance'> = {
    colors,
    spacing: { none: 0, xs: 1, sm: 1, md: 2, lg: 3, xl: 4 },
    borders: {
      default: 'single',
      emphasis: 'double',
      none: 'none',
    },
    typography: defaultTypography(colors),
    components: defaultComponents(colors),
  };
  const merged = def.overrides
    ? (deepMerge(baseTheme, def.overrides) as typeof baseTheme)
    : baseTheme;
  return {
    name: def.name,
    displayName: def.displayName,
    appearance: def.appearance,
    ...merged,
  };
}

/**
 * Build a Theme from just a palette + name. Convenience wrapper for
 * the common case where there are no overrides.
 */
export function themeFromPalette(args: {
  name: string;
  displayName: string;
  appearance: ThemeDefinition['appearance'];
  palette: Base16Palette;
  overrides?: DeepPartial<Omit<Theme, 'name' | 'displayName' | 'appearance'>>;
}): Theme {
  return defineTheme(args);
}
