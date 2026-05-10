/**
 * `<SelectList>` — keyboard-navigable selection.
 *
 * Arrow keys (or j/k) move the cursor; Enter commits via `onSelect`.
 * The list re-emits `onChange(idx)` whenever the cursor moves so a
 * parent can mirror the highlight elsewhere (e.g. show a detail
 * panel for the focused item).
 *
 * Controlled or uncontrolled: pass `value` + `onChange` for
 * controlled, or omit both for uncontrolled (component owns state).
 */

import { useEffect, useState } from "react";
import { Box } from "../atoms/Box.tsx";
import { Text } from "../atoms/Text.tsx";
import { useKeybinding } from "../keyboard/registry.tsx";
import { useFocus } from "../focus/manager.tsx";

export interface SelectListItem {
  id: string;
  label: string;
  /** Subtle second-line annotation. */
  detail?: string;
  /** Disabled items are skipped during navigation. */
  disabled?: boolean;
}

export interface SelectListProps {
  items: SelectListItem[];
  /** Controlled selected index. */
  value?: number;
  /** Fires whenever the cursor moves. */
  onChange?: (index: number, item: SelectListItem) => void;
  /** Fires on Enter. */
  onSelect?: (index: number, item: SelectListItem) => void;
  /** Fires on Esc. */
  onCancel?: () => void;
  /** Stable id used by the focus manager. Default: "select-list". */
  focusId?: string;
  /** When true, registers keybindings even without focus context. */
  alwaysCapture?: boolean;
  style?: Record<string, unknown>;
}

export function SelectList({
  items,
  value,
  onChange,
  onSelect,
  onCancel,
  focusId = "select-list",
  alwaysCapture = false,
  style,
}: SelectListProps) {
  const { isFocused } = useFocus(focusId);
  const [internalIdx, setInternalIdx] = useState(value ?? 0);
  const idx = value ?? internalIdx;

  // Keep internal in sync if controlled value changes externally.
  useEffect(() => {
    if (value !== undefined) setInternalIdx(value);
  }, [value]);

  const move = (delta: 1 | -1) => {
    if (items.length === 0) return;
    let next = idx;
    for (let step = 0; step < items.length; step++) {
      next = (next + delta + items.length) % items.length;
      if (!items[next]?.disabled) break;
    }
    setInternalIdx(next);
    const it = items[next];
    if (it) onChange?.(next, it);
  };

  const enabled = isFocused || alwaysCapture;
  useKeybinding("up", "navigate", () => move(-1), { enabled, hidden: true });
  useKeybinding("down", "navigate", () => move(1), { enabled, hidden: true });
  useKeybinding("k", "navigate", () => move(-1), { enabled, hidden: true });
  useKeybinding("j", "navigate", () => move(1), { enabled, hidden: true });
  useKeybinding(
    (k) => k.name === "return" || k.name === "enter",
    "select",
    () => {
      const it = items[idx];
      if (it && !it.disabled) onSelect?.(idx, it);
    },
    { enabled, keyDisplay: "↵" },
  );
  useKeybinding("escape", "cancel", () => onCancel?.(), {
    enabled,
    keyDisplay: "esc",
    hidden: !onCancel,
  });

  return (
    <Box
      variant="transparent"
      style={{ flexDirection: "column", gap: 0, ...style }}
    >
      {items.map((item, i) => {
        const isCursor = i === idx;
        return (
          <Box
            key={item.id}
            variant={isCursor ? "panel" : "transparent"}
            style={{ flexDirection: "row", gap: 1, paddingLeft: 1, paddingRight: 1 }}
          >
            <Text variant={isCursor ? "accent" : item.disabled ? "subtle" : "body"}>
              {isCursor ? "▸" : " "}
            </Text>
            <Text variant={item.disabled ? "subtle" : isCursor ? "accent" : "body"}>
              {item.label}
            </Text>
            {item.detail ? (
              <Text variant="subtle">{item.detail}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
