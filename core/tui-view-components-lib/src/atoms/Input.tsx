/**
 * `<Input>` — themed single-line text entry. Wraps openTUI's `<input>`.
 *
 * Variants:
 *   default — bg + visible border (standard form field)
 *   filled  — surface bg, no visible border
 *   flushed — borderless, just the foreground text
 *
 * The exact shape of `onChange` / `onInput` / `onSubmit` differs
 * between @opentui/react versions. We type our wrapper props loosely
 * (`(value: string) => void`) and forward through with a cast.
 */

import { useThemeTokens } from "../theme/hooks.ts";

export type InputVariant = "default" | "filled" | "flushed";

export interface InputProps {
  variant?: InputVariant;
  value?: string;
  placeholder?: string;
  focused?: boolean;
  /** Fires on every input change. */
  onInput?: (value: string) => void;
  /** Fires when the value is committed (often Enter). */
  onSubmit?: (value: string) => void;
  style?: Record<string, unknown>;
  [extraProp: string]: unknown;
}

export function Input({
  variant = "default",
  value,
  placeholder,
  focused,
  onInput,
  onSubmit,
  style,
  ...rest
}: InputProps) {
  const theme = useThemeTokens();
  const v = theme.components.input.variants[variant];

  const merged: Record<string, unknown> = {
    backgroundColor: v.bg,
    fg: v.fg,
    borderColor: v.borderColor,
    placeholderColor: v.placeholderFg,
    ...style,
  };

  return (
    <input
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={merged as any}
      value={value}
      placeholder={placeholder}
      focused={focused}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onInput={onInput as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onSubmit={onSubmit as any}
      {...(rest as Record<string, unknown>)}
    />
  );
}
