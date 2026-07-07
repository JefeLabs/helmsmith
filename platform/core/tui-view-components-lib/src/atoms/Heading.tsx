/**
 * `<Heading>` — themed heading. Maps `level` (1–3) to typography
 * presets and adjusts emphasis.
 *
 *   <Heading level={1}>Title</Heading>     → title preset (bold + accent)
 *   <Heading level={2}>Heading</Heading>   → heading preset (bold)
 *   <Heading level={3}>Subheading</Heading> → subheading preset (bold + muted)
 */

import type { ReactNode } from 'react';
import type { TypographyPreset } from '../theme/types.ts';
import { Text } from './Text.tsx';

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingProps {
  level?: HeadingLevel;
  style?: Record<string, unknown>;
  children?: ReactNode;
  [extraProp: string]: unknown;
}

const PRESET_BY_LEVEL: Record<HeadingLevel, TypographyPreset> = {
  1: 'title',
  2: 'heading',
  3: 'subheading',
};

export function Heading({ level = 2, style, children, ...rest }: HeadingProps) {
  return (
    <Text preset={PRESET_BY_LEVEL[level]} style={style} {...rest}>
      {children}
    </Text>
  );
}
