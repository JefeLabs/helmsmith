/**
 * `<Box>` — themed container. Wraps openTUI's `<box>` intrinsic and
 * resolves variant/padding tokens against the active theme.
 *
 * Variants (see `theme.components.box.variants`):
 *   default     — plain background, no border
 *   panel       — surface bg + single border
 *   overlay     — overlay bg + accent border (for modals)
 *   transparent — no background, no border
 *
 * Implementation note: the underlying openTUI prop surface evolves
 * across versions (border, borderStyle, padding, gap, etc.). We
 * deliberately cast at the JSX boundary so this wrapper survives
 * version churn. If a specific style isn't applying, check your
 * `@opentui/core` version's BoxOptions and update the merge below.
 */

import type { ReactNode } from "react";
import { useThemeTokens } from "../theme/hooks.ts";
import type { SpacingKey } from "../theme/types.ts";

export type BoxVariant = "default" | "panel" | "overlay" | "transparent";

export interface BoxProps {
  variant?: BoxVariant;
  padding?: SpacingKey;
  paddingX?: SpacingKey;
  paddingY?: SpacingKey;
  /** Pass-through openTUI props (flexDirection, gap, etc.). */
  style?: Record<string, unknown>;
  children?: ReactNode;
  [extraProp: string]: unknown;
}

export function Box({
  variant = "default",
  padding,
  paddingX,
  paddingY,
  style,
  children,
  ...rest
}: BoxProps) {
  const theme = useThemeTokens();
  const v = theme.components.box.variants[variant];
  const px = paddingX ?? padding;
  const py = paddingY ?? padding;

  const merged: Record<string, unknown> = {
    ...(v.bg ? { backgroundColor: v.bg } : {}),
    ...(v.border && v.border !== "none"
      ? { border: true, borderStyle: v.border }
      : {}),
    ...(v.borderColor ? { borderColor: v.borderColor } : {}),
    ...(px !== undefined
      ? { paddingLeft: theme.spacing[px], paddingRight: theme.spacing[px] }
      : {}),
    ...(py !== undefined
      ? { paddingTop: theme.spacing[py], paddingBottom: theme.spacing[py] }
      : {}),
    ...style,
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <box style={merged as any} {...(rest as any)}>
      {children}
    </box>
  );
}
