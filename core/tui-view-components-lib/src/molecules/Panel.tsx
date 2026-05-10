/**
 * `<Panel>` — themed bordered region with an optional title bar.
 * Composes `<Box variant="panel">` + an optional `<Text>` title.
 *
 * For full-screen modals/overlays, use `<Box variant="overlay">`
 * directly. Panel is for grouped content blocks within a larger view
 * (debug panels, setting groups, status displays).
 */

import type { ReactNode } from "react";
import { Box } from "../atoms/Box.tsx";
import { Text } from "../atoms/Text.tsx";
import { useThemeTokens } from "../theme/hooks.ts";
import type { SpacingKey } from "../theme/types.ts";

export interface PanelProps {
  title?: string;
  /** Override the panel's padding. Defaults to theme.components.panel.padding. */
  padding?: SpacingKey;
  style?: Record<string, unknown>;
  children?: ReactNode;
  [extraProp: string]: unknown;
}

export function Panel({
  title,
  padding,
  style,
  children,
  ...rest
}: PanelProps) {
  const theme = useThemeTokens();
  const effectivePadding = padding ?? theme.components.panel.padding;

  return (
    <Box variant="panel" padding={effectivePadding} style={style} {...rest}>
      {title ? (
        <Text
          color={theme.components.panel.titleFg}
          bg={theme.components.panel.titleBg}
        >
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}
