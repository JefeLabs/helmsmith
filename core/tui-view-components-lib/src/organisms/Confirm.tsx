/**
 * `<Confirm>` — yes/no modal. Y/n keys answer; Enter confirms the
 * highlighted choice; Esc cancels (no).
 *
 * Renders inline (caller controls visibility). Caller passes
 * `onConfirm` and optional `onCancel`; the component cleans up
 * its own keybindings when unmounted.
 */

import { Box } from '../atoms/Box.tsx';
import { Heading } from '../atoms/Heading.tsx';
import { Text } from '../atoms/Text.tsx';
import { useKeybinding } from '../keyboard/registry.tsx';

export interface ConfirmProps {
  title?: string;
  message: string;
  /** Default action when Enter is pressed without y/n. */
  defaultAnswer?: 'yes' | 'no';
  onConfirm: () => void;
  onCancel?: () => void;
  /** Override the prompt strings. */
  yesLabel?: string;
  noLabel?: string;
}

export function Confirm({
  title,
  message,
  defaultAnswer = 'no',
  onConfirm,
  onCancel,
  yesLabel = 'yes',
  noLabel = 'no',
}: ConfirmProps) {
  useKeybinding('y', yesLabel, onConfirm);
  useKeybinding('n', noLabel, () => {
    onCancel?.();
  });
  useKeybinding(
    (k) => k.name === 'return' || k.name === 'enter',
    `${defaultAnswer === 'yes' ? yesLabel : noLabel} (default)`,
    () => {
      if (defaultAnswer === 'yes') onConfirm();
      else onCancel?.();
    },
    { keyDisplay: '↵' },
  );
  useKeybinding('escape', 'cancel', () => onCancel?.(), {
    keyDisplay: 'esc',
    hidden: !onCancel,
  });

  const yesPrompt = defaultAnswer === 'yes' ? `[${yesLabel.toUpperCase()}]` : yesLabel;
  const noPrompt = defaultAnswer === 'no' ? `[${noLabel.toUpperCase()}]` : noLabel;

  return (
    <Box variant="overlay" padding="md" style={{ flexDirection: 'column', gap: 1, minWidth: 36 }}>
      {title ? <Heading level={2}>{title}</Heading> : null}
      <Text>{message}</Text>
      <Box variant="transparent" style={{ flexDirection: 'row', gap: 2 }}>
        <Text variant="muted">y {yesPrompt}</Text>
        <Text variant="muted">n {noPrompt}</Text>
      </Box>
    </Box>
  );
}
