/**
 * Atoms — single-element building blocks. Cannot be broken down
 * further while remaining meaningful. Each atom wraps an openTUI
 * intrinsic and resolves theme tokens.
 *
 * Per Atomic Design (Brad Frost): atoms are the foundational
 * elements; molecules and organisms compose them.
 */

export { Box } from "./Box.tsx";
export type { BoxProps, BoxVariant } from "./Box.tsx";

export { Text } from "./Text.tsx";
export type { TextProps, TextVariant } from "./Text.tsx";

export { Heading } from "./Heading.tsx";
export type { HeadingProps, HeadingLevel } from "./Heading.tsx";

export { Button } from "./Button.tsx";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button.tsx";

export { Input } from "./Input.tsx";
export type { InputProps, InputVariant } from "./Input.tsx";
