/**
 * `<Span>` — inline themed text. Wraps openTUI's `<span>` intrinsic.
 *
 * Use Span (not Text) when you need inline emphasis inside another Text:
 *
 *   <Text variant="muted">Press <Span variant="accent">c</Span> to open.</Text>
 *
 * `<Text>` renders a TextRenderable (block-level) which cannot contain
 * another TextRenderable as a child. `<Span>` renders a TextNodeRenderable
 * which is exactly what TextRenderable's `add()` accepts.
 */

import type { ReactNode } from 'react';
import { useThemeTokens } from '../theme/hooks.ts';
import type { TextVariant } from './Text.tsx';

export interface SpanProps {
  variant?: TextVariant;
  /** Override the foreground color directly. */
  color?: string;
  children?: ReactNode;
  [extraProp: string]: unknown;
}

export function Span({ variant = 'body', color, children, ...rest }: SpanProps) {
  const theme = useThemeTokens();
  const v = theme.components.text.variants[variant];
  const fg = color ?? v.fg ?? theme.colors.text;

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <span fg={fg} {...(rest as any)}>
      {children}
    </span>
  );
}
