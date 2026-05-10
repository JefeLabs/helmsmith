/**
 * `<Spinner>` — animated indicator with an optional label and percent.
 *
 * Cycles through dots-style frames at ~10fps. When `label` is given,
 * renders to the right of the spinner. When `progress` is given (0–1),
 * renders a percentage after the label.
 */

import { useEffect, useState } from 'react';
import { Box } from '../atoms/Box.tsx';
import { Text } from '../atoms/Text.tsx';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface SpinnerProps {
  label?: string;
  /** 0–1 fractional progress. Rendered as a percentage after the label. */
  progress?: number;
  /** Frame interval in ms. Default: 80. */
  intervalMs?: number;
  style?: Record<string, unknown>;
}

export function Spinner({ label, progress, intervalMs = 80, style }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const pct =
    progress !== undefined ? `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` : null;

  return (
    <Box variant="transparent" style={{ flexDirection: 'row', gap: 1, ...style }}>
      <Text variant="accent">{FRAMES[frame]}</Text>
      {label ? <Text>{label}</Text> : null}
      {pct ? <Text variant="muted">{pct}</Text> : null}
    </Box>
  );
}
