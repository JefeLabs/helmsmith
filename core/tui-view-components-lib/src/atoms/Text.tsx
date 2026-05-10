/**
 * `<Text>` — themed text. Wraps openTUI's `<text>` intrinsic.
 *
 * Variants: body, muted, subtle, inverted, accent
 * Presets:  title, heading, subheading, body, caption, code, label
 *
 * openTUI's text uses `fg` for foreground and `bg` for background;
 * bold/italic come via the `attributes` bitfield. We expose the
 * common knobs as typed props and let `style` carry anything else
 * the consumer's @opentui version supports.
 */

import type { ReactNode } from 'react';
import { useThemeTokens } from '../theme/hooks.ts';
import type { TypographyPreset } from '../theme/types.ts';

export type TextVariant = 'body' | 'muted' | 'subtle' | 'inverted' | 'accent';

export interface TextProps {
  variant?: TextVariant;
  preset?: TypographyPreset;
  /** Override the foreground color directly. */
  color?: string;
  /** Override the background color directly. */
  bg?: string;
  style?: Record<string, unknown>;
  children?: ReactNode;
  [extraProp: string]: unknown;
}

export function Text({ variant = 'body', preset, color, bg, style, children, ...rest }: TextProps) {
  const theme = useThemeTokens();
  const v = theme.components.text.variants[variant];
  const p = preset ? theme.typography[preset] : undefined;

  const fg = color ?? p?.fg ?? v.fg ?? theme.colors.text;

  const merged: Record<string, unknown> = {
    fg,
    ...(bg ? { bg } : {}),
    ...style,
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <text style={merged as any} {...(rest as any)}>
      {children}
    </text>
  );
}
