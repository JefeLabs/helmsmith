/**
 * `<Menu>` — hierarchical navigation menu with breadcrumb-style
 * submenus, tab navigation, and a configurable exit hotkey.
 *
 * Two layouts:
 *
 *   layout="stacked" (default)
 *     Every visited level renders as a row. Earlier levels stay
 *     visible as muted breadcrumb context; the deepest row receives
 *     keystrokes.
 *
 *       [1] Sections  [2] Files  [3] Settings    ← muted (path)
 *         [1] Typography  [2] Buttons  [3] Table ← active
 *
 *   layout="single"
 *     Only the deepest level renders, with an inline breadcrumb
 *     above showing the path:
 *
 *       Sections › Typography ›
 *       [1] Heading  [2] Body  [3] Code
 *
 * Navigation:
 *   1-9       jump to item at current level
 *   Tab       next item
 *   Shift+Tab previous item
 *   Enter     drill in (if submenu) or fire onSelect (if leaf)
 *   exitKey   pop one level (default: "escape")
 *
 * Each item with a submenu shows a `›` marker. Custom hotkeys can
 * override the auto-assigned 1-9 via `MenuItem.hotkey`.
 */

import { useState, type ReactNode } from "react";
import { Box } from "../atoms/Box.tsx";
import { Text } from "../atoms/Text.tsx";
import { Panel } from "../molecules/Panel.tsx";
import { useKeybinding } from "../keyboard/registry.tsx";

export interface MenuItem {
  /** Stable id (React key). */
  id: string;
  /** Display label. */
  label: string;
  /** Optional 1-char hotkey override. Defaults to position (1-9). */
  hotkey?: string;
  /** Optional badge shown after the label (e.g. "new", "9 items"). */
  badge?: string;
  /** Optional submenu. If present, Enter drills in; otherwise Enter
   *  triggers `onSelect`. */
  submenu?: MenuItem[];
  /** Leaf action — fires when this item is the selection target
   *  (no submenu). The Menu's top-level `onSelect` also fires. */
  onSelect?: () => void;
}

export interface MenuProps {
  items: MenuItem[];
  /** Fires whenever the active path changes (drill, exit, navigate). */
  onChange?: (path: MenuItem[]) => void;
  /** Fires when the user activates a leaf (Enter on a no-submenu item). */
  onSelect?: (path: MenuItem[]) => void;
  /** "stacked" shows every visited level; "single" shows breadcrumb
   *  + only the deepest level. Default: "stacked". */
  layout?: "stacked" | "single";
  /** Key name that pops one level. Default: "escape". Set to null to
   *  disable. */
  exitKey?: string | null;
  /** Show numeric hotkey hints (e.g. `[1] label`). Default: true. */
  showHotkeys?: boolean;
  /** Override the breadcrumb separator (single layout only). Default: " › ". */
  breadcrumbSeparator?: string;
  /** Optional title rendered as a Panel. Default: no title (no Panel wrapper). */
  title?: string;
  /** Render after the menu items (e.g. a hint or status indicator). */
  footer?: ReactNode;
}

interface Level {
  /** The item that opened this level (null = root). */
  parent: MenuItem | null;
  /** Items shown at this level. */
  items: MenuItem[];
  /** Cursor index within `items`. */
  idx: number;
}

const MENU_BREAKPOINT = 9; // hotkeys 1-9 only

function hotkeyFor(item: MenuItem, idx: number): string {
  if (item.hotkey) return item.hotkey;
  if (idx < MENU_BREAKPOINT) return String(idx + 1);
  return "";
}

// ────────────────────────────────────────────────────────────────────
// MenuRow — a single horizontal row of items
// ────────────────────────────────────────────────────────────────────

function MenuRow({
  level,
  active,
  showHotkeys,
  indent,
  onItemClick,
}: {
  level: Level;
  active: boolean;
  showHotkeys: boolean;
  indent: number;
  onItemClick?: (idx: number) => void;
}) {
  return (
    <Box
      variant="transparent"
      style={{
        flexDirection: "row",
        gap: 1,
        paddingLeft: indent,
      }}
    >
      {level.items.map((item, i) => {
        const isCursor = active && i === level.idx;
        const hk = showHotkeys ? hotkeyFor(item, i) : "";
        const drillsIn = Boolean(item.submenu && item.submenu.length > 0);
        return (
          <Box
            key={item.id}
            variant={isCursor ? "panel" : "transparent"}
            padding="xs"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...({ onPress: () => onItemClick?.(i) } as any)}
          >
            <Text variant={isCursor ? "accent" : active ? "body" : "muted"}>
              {hk ? `[${hk}] ` : ""}
              {item.label}
              {drillsIn ? " ›" : ""}
              {item.badge ? ` (${item.badge})` : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────────
// Breadcrumb — for "single" layout
// ────────────────────────────────────────────────────────────────────

function Breadcrumb({
  path,
  separator,
}: {
  path: MenuItem[];
  separator: string;
}) {
  if (path.length === 0) return null;
  return (
    <Box variant="transparent" style={{ flexDirection: "row", paddingLeft: 1 }}>
      <Text variant="subtle">
        {path.map((p) => p.label).join(separator)}
        {separator}
      </Text>
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────────
// Menu
// ────────────────────────────────────────────────────────────────────

export function Menu({
  items,
  onChange,
  onSelect,
  layout = "stacked",
  exitKey = "escape",
  showHotkeys = true,
  breadcrumbSeparator = " › ",
  title,
  footer,
}: MenuProps) {
  // Stack of active levels. `levels[0]` is the root.
  const [levels, setLevels] = useState<Level[]>(() => [
    { parent: null, items, idx: 0 },
  ]);

  const deepest = levels[levels.length - 1]!;
  const path: MenuItem[] = levels
    .slice(1) // exclude root
    .map((l) => l.parent!)
    .filter(Boolean);

  const fireChange = (newLevels: Level[]) => {
    const newPath = newLevels
      .slice(1)
      .map((l) => l.parent!)
      .filter(Boolean);
    onChange?.(newPath);
  };

  const setCursor = (newIdx: number) => {
    const next = [...levels];
    next[next.length - 1] = { ...deepest, idx: newIdx };
    setLevels(next);
    // Cursor moves are also path changes (the leaf preview shifts).
    fireChange(next);
  };

  const drill = () => {
    const item = deepest.items[deepest.idx];
    if (!item) return;
    if (item.submenu && item.submenu.length > 0) {
      const next = [
        ...levels,
        { parent: item, items: item.submenu, idx: 0 },
      ];
      setLevels(next);
      fireChange(next);
    } else {
      const newPath = [...path, item];
      item.onSelect?.();
      onSelect?.(newPath);
    }
  };

  const exit = () => {
    if (levels.length <= 1) return;
    const next = levels.slice(0, -1);
    setLevels(next);
    fireChange(next);
  };

  // ── Keybindings ────────────────────────────────────────────────────

  // Number hotkeys 1-9 → set cursor at current level
  for (let i = 0; i < MENU_BREAKPOINT; i++) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useKeybinding(
      String(i + 1),
      `select`,
      () => {
        if (i < deepest.items.length) setCursor(i);
      },
      { hidden: true },
    );
  }

  // Custom hotkey overrides (user-set per-item)
  for (const item of deepest.items) {
    if (item.hotkey && /^[a-z]$/i.test(item.hotkey)) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useKeybinding(
        item.hotkey,
        item.label,
        () => {
          const idx = deepest.items.indexOf(item);
          if (idx >= 0) setCursor(idx);
        },
        { hidden: true },
      );
    }
  }

  useKeybinding(
    "tab",
    "next",
    () => {
      if (deepest.items.length === 0) return;
      const next = (deepest.idx + 1) % deepest.items.length;
      setCursor(next);
    },
    { keyDisplay: "⇥" },
  );

  useKeybinding(
    (k) => k.shift === true && k.name === "tab",
    "prev",
    () => {
      if (deepest.items.length === 0) return;
      const prev =
        (deepest.idx - 1 + deepest.items.length) % deepest.items.length;
      setCursor(prev);
    },
    { keyDisplay: "⇧⇥" },
  );

  useKeybinding(
    (k) => k.name === "return" || k.name === "enter",
    "select / drill",
    drill,
    { keyDisplay: "↵" },
  );

  useKeybinding(
    exitKey ?? "escape",
    "back",
    exit,
    { hidden: levels.length <= 1 || exitKey === null, keyDisplay: "esc" },
  );

  // ── Render ─────────────────────────────────────────────────────────

  let content: ReactNode;
  if (layout === "stacked") {
    content = (
      <Box variant="transparent" style={{ flexDirection: "column", gap: 0 }}>
        {levels.map((level, i) => (
          <MenuRow
            key={i}
            level={level}
            active={i === levels.length - 1}
            showHotkeys={showHotkeys}
            indent={i * 2}
            onItemClick={i === levels.length - 1 ? setCursor : undefined}
          />
        ))}
      </Box>
    );
  } else {
    // single layout
    content = (
      <Box variant="transparent" style={{ flexDirection: "column", gap: 0 }}>
        <Breadcrumb path={path} separator={breadcrumbSeparator} />
        <MenuRow
          level={deepest}
          active
          showHotkeys={showHotkeys}
          indent={0}
          onItemClick={setCursor}
        />
      </Box>
    );
  }

  const body = (
    <Box variant="transparent" style={{ flexDirection: "column", gap: 1 }}>
      {content}
      {footer ?? null}
    </Box>
  );

  return title ? (
    <Panel title={title} padding="sm">
      {body}
    </Panel>
  ) : (
    <Panel padding="sm">{body}</Panel>
  );
}
