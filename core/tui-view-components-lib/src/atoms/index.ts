/**
 * Atoms — single-element building blocks. Cannot be broken down
 * further while remaining meaningful. Each atom wraps an openTUI
 * intrinsic and resolves theme tokens.
 *
 * Per Atomic Design (Brad Frost): atoms are the foundational
 * elements; molecules and organisms compose them.
 */

export type { BoxProps, BoxVariant } from './Box.tsx';
export { Box } from './Box.tsx';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button.tsx';
export { Button } from './Button.tsx';
export type { HeadingLevel, HeadingProps } from './Heading.tsx';
export { Heading } from './Heading.tsx';
export type { InputProps, InputVariant } from './Input.tsx';
export { Input } from './Input.tsx';
export type { TextProps, TextVariant } from './Text.tsx';
export { Text } from './Text.tsx';
