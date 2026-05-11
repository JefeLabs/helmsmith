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

import { useThemeTokens } from '../theme/hooks.ts';

export type InputVariant = 'default' | 'filled' | 'flushed';

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
  variant = 'default',
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

  // openTUI's <input> uses `textColor` (not `fg`), has no border slot of its
  // own, and collapses to width 0 if not given an explicit width. The
  // renderable always paints a bg, so the theme picks a per-variant fill
  // (flushed → surface, to blend into Panels — see input tokens).
  const inputStyle: Record<string, unknown> = {
    backgroundColor: v.bg,
    textColor: v.fg,
    focusedBackgroundColor: v.bg,
    focusedTextColor: v.fg,
    placeholderColor: v.placeholderFg,
    width: '100%',
  };

  const inputEl = (
    <input
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={inputStyle as any}
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

  // Always wrap so every variant has a consistent inner content column.
  // Variants differ only in whether they paint a border and whether the
  // wrapper has its own bg fill; border characters and style are static.
  //
  // Padding is tuned per-variant so content aligns horizontally when
  // form fields stack vertically. A border occupies 1 cell on each side,
  // so flushed (no border) absorbs that cell into its padding to keep
  // the cursor column identical to the bordered variants.
  const hasBorder = variant === 'default';
  const contentPad = hasBorder ? 1 : 2;
  const boxStyle: Record<string, unknown> = {
    border: hasBorder,
    borderStyle: 'single',
    borderColor: v.borderColor,
    // Wrapper uses the same fill as the input so the padding region
    // doesn't show a different color than the editable area.
    backgroundColor: v.bg,
    width: '100%',
    paddingLeft: contentPad,
    paddingRight: contentPad,
    ...style,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <box style={boxStyle as any}>{inputEl}</box>;
}
