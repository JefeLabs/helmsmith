/**
 * `<Button>` — themed clickable region. A `<box>` with a `<text>`
 * inside. Resolves variant + size from theme tokens.
 *
 * Variants: primary, secondary, ghost, danger, success
 * Sizes:    sm, md, lg
 *
 * State (orthogonal to variant):
 *   selected  — persistent "this is the active option". Fills bg with
 *               the variant's intent color (bgActive).
 *   focused   — transient "keyboard cursor is here". Fills bg with
 *               the variant's accent shade (bgFocus). Wins over
 *               selected when both are true.
 *   disabled  — dim fg on default bg. Suppresses other states.
 *
 * Click handling on terminal "buttons" varies by openTUI version
 * (no native onClick); we forward `onPress` and `onClick` for both.
 */

import type { ReactNode } from 'react';
import { useThemeTokens } from '../theme/hooks.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Persistent active state — e.g. the currently-selected tab. */
  selected?: boolean;
  /** Transient keyboard-focus state — follows the cursor. */
  focused?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: Record<string, unknown>;
  children?: ReactNode;
  [extraProp: string]: unknown;
}

export function Button({
  variant = 'primary',
  size = 'md',
  selected = false,
  focused = false,
  disabled = false,
  onPress,
  style,
  children,
  ...rest
}: ButtonProps) {
  const theme = useThemeTokens();
  const v = theme.components.button.variants[variant];
  const s = theme.components.button.sizes[size];

  // Block-style state indication. Precedence (highest → lowest):
  //   disabled  > focused  > selected  > default
  // Border characters/style stay static across all states; only the bg
  // fill (and fg for contrast) shifts.
  let bg: string;
  let fg: string;
  if (disabled) {
    bg = theme.colors.background;
    fg = theme.colors.textSubtle;
  } else if (focused) {
    bg = v.bgFocus ?? v.bg;
    fg = v.fgFocus ?? v.fg;
  } else if (selected) {
    bg = v.bgActive ?? v.bg;
    fg = v.fgActive ?? v.fg;
  } else {
    bg = v.bg;
    fg = v.fg;
  }

  // Fixed width + explicit height = consistent rows. Height = content (1) +
  // top/bottom padding + 2 for the single-line border.
  const buttonHeight = 1 + s.paddingY * 2 + 2;

  const boxStyle: Record<string, unknown> = {
    backgroundColor: bg,
    border: true,
    borderStyle: 'single',
    // Border color is static per variant — never restyled for focus/disabled
    // (only the cell background changes on state).
    borderColor: v.borderColor,
    paddingLeft: s.paddingX,
    paddingRight: s.paddingX,
    paddingTop: s.paddingY,
    paddingBottom: s.paddingY,
    width: s.width,
    height: buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...style,
  };

  const handler = disabled ? undefined : onPress;

  // openTUI's `<box>` doesn't formally type onPress/onClick, but
  // recent versions accept them. We bundle everything into a single
  // any-spread so the JSX element doesn't reject the named props.
  const boxProps: Record<string, unknown> = {
    style: boxStyle,
    onPress: handler,
    onClick: handler,
    ...rest,
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <box {...(boxProps as any)}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <text style={{ fg } as any}>{children}</text>
    </box>
  );
}
