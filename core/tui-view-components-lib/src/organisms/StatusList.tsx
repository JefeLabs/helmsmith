/**
 * `<StatusList>` — vertical list of items each with a status icon.
 *
 * Read-only display (not interactive). Used in ConnectView to show
 * each Connection's state. Maps state → icon → theme color slot:
 *
 *   connected    → ✓ (success)
 *   expired      → ⏳ (warning)
 *   disconnected → ✗ (danger)
 *   pending      → · (text muted)
 *
 * Optional secondary line per item (subtle text).
 */

import { Box } from '../atoms/Box.tsx';
import { Text } from '../atoms/Text.tsx';
import { useThemeTokens } from '../theme/hooks.ts';

export type StatusListItemState = 'connected' | 'expired' | 'disconnected' | 'pending';

export interface StatusListItem {
  /** Stable id; not displayed but useful as React key. */
  id: string;
  label: string;
  state: StatusListItemState;
  /** Subtle second line (e.g. "logged in as @ecruz165"). */
  detail?: string;
  /** Marker shown after the label (e.g. "required" / "optional"). */
  badge?: string;
}

export interface StatusListProps {
  items: StatusListItem[];
  /** Width-fixing for clean alignment. Default: 32. */
  labelWidth?: number;
  style?: Record<string, unknown>;
}

const ICON: Record<StatusListItemState, string> = {
  connected: '✓',
  expired: '⏳',
  disconnected: '✗',
  pending: '·',
};

export function StatusList({ items, labelWidth = 32, style }: StatusListProps) {
  const theme = useThemeTokens();
  const colorFor: Record<StatusListItemState, string> = {
    connected: theme.colors.success,
    expired: theme.colors.warning,
    disconnected: theme.colors.danger,
    pending: theme.colors.textMuted,
  };

  return (
    <Box variant="transparent" style={{ flexDirection: 'column', gap: 0, ...style }}>
      {items.map((item) => (
        <Box key={item.id} variant="transparent" style={{ flexDirection: 'column' }}>
          <Box variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
            <Text color={colorFor[item.state]}>{ICON[item.state]}</Text>
            <Text style={{ minWidth: labelWidth }}>{item.label}</Text>
            {item.badge ? <Text variant="muted">{item.badge}</Text> : null}
          </Box>
          {item.detail ? (
            <Box variant="transparent" style={{ flexDirection: 'row', paddingLeft: 4 }}>
              <Text variant="subtle">{item.detail}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
