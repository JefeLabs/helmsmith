/**
 * `<Button>` — themed clickable region. A `<box>` with a `<text>`
 * inside. Resolves variant + size from theme tokens.
 *
 * Variants: primary, secondary, ghost, danger, success
 * Sizes:    sm, md, lg
 *
 * Focus: pass `focused` to use the `bgFocus`/`fgFocus` slots.
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

  const bg = focused && v.bgFocus ? v.bgFocus : v.bg;
  const fg = focused && v.fgFocus ? v.fgFocus : v.fg;

  const boxStyle: Record<string, unknown> = {
    backgroundColor: bg,
    border: true,
    borderStyle: 'single',
    borderColor: v.borderColor,
    paddingLeft: s.paddingX,
    paddingRight: s.paddingX,
    paddingTop: s.paddingY,
    paddingBottom: s.paddingY,
    minWidth: s.minWidth,
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
