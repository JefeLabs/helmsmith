/**
 * `<KeybindingsBar>` — bottom help bar listing the active keybindings.
 *
 * Reads from the KeyboardProvider registry; auto-updates as bindings
 * mount/unmount. Hidden bindings (`hidden: true`) and unlabeled
 * entries are filtered out.
 *
 *   ↑↓ navigate · enter login · l logout · q quit
 */

import { Text } from "../atoms/Text.tsx";
import { Box } from "../atoms/Box.tsx";
import { useKeybindings } from "../keyboard/registry.tsx";

export interface KeybindingsBarProps {
  /** Override separator between entries. Defaults to " · ". */
  separator?: string;
  style?: Record<string, unknown>;
}

export function KeybindingsBar({
  separator = " · ",
  style,
}: KeybindingsBarProps) {
  const bindings = useKeybindings().filter((b) => !b.hidden);
  if (bindings.length === 0) return null;

  return (
    <Box variant="transparent" style={style}>
      <Text variant="subtle">
        {bindings
          .map((b) => `${b.keyDisplay ?? b.label} ${b.label}`)
          .join(separator)}
      </Text>
    </Box>
  );
}
