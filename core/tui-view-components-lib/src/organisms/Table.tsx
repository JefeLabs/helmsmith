/**
 * `<Table>` — structured tabular data with selective row re-render,
 * skeleton row loading, pinned rows, cursor highlight, and an optional
 * master/detail layout.
 *
 * Usage modes:
 *
 *   1. Plain display:
 *      <Table columns={...} rows={...} rowKey="id" pinHeader />
 *
 *   2. Selectable with detail pane:
 *      <Table
 *        columns={...} rows={...} rowKey="id"
 *        selectable pinHeader
 *        onChange={(row) => ...}
 *        onSelect={(row) => ...}
 *        renderDetail={(row) => ...}
 *      />
 *
 *   3. Streaming + skeleton placeholders:
 *      const tableRef = useRef<TableHandle<MyRow>>(null);
 *      <Table ref={tableRef} rows={[]} rowKey="id" {...} />
 *      // Show 5 skeleton rows while we fetch:
 *      tableRef.current?.setLoadingPlaceholders(5);
 *      const data = await fetchRows();
 *      tableRef.current?.replaceAll(data);   // clears placeholders
 *
 *      // Or stream individual updates:
 *      tableRef.current?.markLoading("user-42");
 *      const fresh = await fetchUser(42);
 *      tableRef.current?.replaceRow("user-42", fresh);  // auto-unmarks
 *
 * ─── Imperative API (TableHandle) ─────────────────────────────────
 *
 *   updateRow(key, partial)    merge fields into one row
 *   updateRows(updates)        atomic batch merge
 *   replaceRow(key, row)       overwrite a row wholesale
 *   upsertRow(row)             insert-or-replace by derived key
 *   removeRow(key)             delete by key
 *   replaceAll(rows)           re-seed the entire dataset
 *   markLoading(key|keys)      flag rows as in-flight (renders skeleton)
 *   clearLoading(key|keys)     unflag (or call updateRow/replaceRow)
 *   setLoadingPlaceholders(n)  show N synthetic skeleton rows at bottom
 *                              (cleared automatically on replaceAll)
 *   getRow(key)                read current row
 *   getRows()                  read all rows in current order
 *
 * ─── Per-instance render cache ────────────────────────────────────
 *
 * Rows are stored in a `Map<key, T>`. When `updateRow` runs, only the
 * targeted row's reference changes — every other row keeps identity,
 * and `React.memo` on `<Row>` short-circuits their re-render. The
 * visual effect: cursor and untouched rows stay perfectly stable;
 * only the touched cells re-render. The header row is also memoized
 * so unchanged column definitions don't trigger header repaints.
 *
 * Pin options:
 *   pinHeader    — column titles always visible
 *   pinFirstRow  — first data row (insertion order) stays at the top
 *                  of the cursor-navigable body
 *   footerRow    — caller-provided footer row, always pinned at bottom
 */

import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Box } from "../atoms/Box.tsx";
import { Text } from "../atoms/Text.tsx";
import { useThemeTokens } from "../theme/hooks.ts";
import { useKeybinding } from "../keyboard/registry.ts";
import { useFocus } from "../focus/manager.tsx";

export interface TableColumn<T> {
  /** Field id. Used as React key per cell + as the property accessor
   *  when no `render` is provided. */
  key: string;
  /** Header label rendered when `pinHeader` is set. */
  label: string;
  /** Fixed column width in characters. */
  width: number;
  /** Alignment of the cell content. Default: "left". */
  align?: "left" | "center" | "right";
  /** Custom cell renderer. Defaults to `String(row[key])`. */
  render?: (row: T, rowIndex: number) => ReactNode;
  /** Long-form description shown in `<TableHelp>`. Authoring this
   *  here keeps the docs co-located with the column definition. */
  description?: string;
}

export interface TableHandle<T> {
  /** Merge `update` into the row identified by `key`.
   *  Auto-clears any loading flag on that row. */
  updateRow(key: string, update: Partial<T>): void;
  /** Atomic batch of updateRow calls. Auto-clears loading flags. */
  updateRows(updates: Array<{ key: string; update: Partial<T> }>): void;
  /** Replace the row at `key` with a fresh object.
   *  Auto-clears loading flag. */
  replaceRow(key: string, row: T): void;
  /** Insert-or-replace a row using its derived key. */
  upsertRow(row: T): void;
  /** Remove the row at `key`. No-op if absent. */
  removeRow(key: string): void;
  /** Replace the entire dataset. Order = insertion order of `rows`.
   *  Clears all loading flags and skeleton placeholders. */
  replaceAll(rows: T[]): void;
  /** Mark one or more rows as loading. Their cells render as
   *  skeleton bars until cleared (manually or via a row update). */
  markLoading(keyOrKeys: string | string[]): void;
  /** Manually clear loading flags. */
  clearLoading(keyOrKeys?: string | string[]): void;
  /** Show N synthetic skeleton rows at the bottom of the body.
   *  Useful for "fetching first page" / "loading more" UX. Cleared
   *  by `replaceAll` or by passing 0. */
  setLoadingPlaceholders(count: number): void;
  /** Read the current row by key. */
  getRow(key: string): T | undefined;
  /** Read all rows in current order. */
  getRows(): T[];
}

export type RowKey<T> = keyof T | ((row: T) => string);

/**
 * Reorder strategy — controls when (if ever) rows change position
 * in response to inserts and updates.
 *
 *   { mode: "stable" }
 *     Rows render in insertion order. Updates never move existing
 *     rows. New rows always append. Best for log-style streams,
 *     terminal output, or any UX where row jitter would be jarring.
 *     This is the default when no `reorder` prop is supplied.
 *
 *   { mode: "sort", compare, cursorFollow?: "row" | "index" }
 *     Rows are sorted by `compare` on every state change. Updates
 *     can move rows (e.g. a status change pushes a row to the top).
 *     `cursorFollow` controls cursor behavior across reorders:
 *       "row"   (default) — cursor sticks to the row it was on, even
 *                          if that row moves to a different index.
 *                          The user's selection is what matters.
 *       "index" — cursor stays at the same numeric index. The row
 *                under the cursor changes when other rows move past.
 */
export type TableReorderStrategy<T> =
  | { mode: "stable" }
  | {
      mode: "sort";
      compare: (a: T, b: T) => number;
      cursorFollow?: "row" | "index";
    };

export interface TableProps<T> {
  /** Initial rows. After mount, the imperative ref API is the source
   *  of truth. Re-seed externally with `tableRef.current.replaceAll`. */
  rows: T[];
  columns: TableColumn<T>[];
  /** How to derive a stable string id for each row. Required for the
   *  imperative update API and skeleton tracking. */
  rowKey: RowKey<T>;

  /** Reorder behavior on insert / update. Default: stable insertion order. */
  reorder?: TableReorderStrategy<T>;

  /** Render header row above the body. */
  pinHeader?: boolean;
  /** Pin the first data row (per the active reorder strategy). */
  pinFirstRow?: boolean;
  /** A footer row pinned at the bottom. */
  footerRow?: T;

  /** Enable keyboard navigation + cursor highlight. */
  selectable?: boolean;
  /** Fires when the cursor moves to a new row. */
  onChange?: (row: T, index: number) => void;
  /** Fires when Enter is pressed on the cursor row. */
  onSelect?: (row: T, index: number) => void;
  /** Fires on Esc. */
  onCancel?: () => void;

  /** When provided AND `selectable`, renders a detail pane next to
   *  the table showing the focused row. */
  renderDetail?: (row: T, index: number) => ReactNode;
  /** Layout for the detail pane. Default: "right". */
  detailPosition?: "right" | "bottom";

  /** Stable id for the focus manager. Default: "table". */
  focusId?: string;
  /** Capture keyboard unconditionally (skip focus check). */
  alwaysCapture?: boolean;
  /** Initial cursor index (uncontrolled). Default: 0. */
  initialIndex?: number;
  /** Controlled cursor index. */
  value?: number;

  /** Imperative handle for streaming row updates / skeleton control. */
  ref?: Ref<TableHandle<T>>;

  style?: Record<string, unknown>;
}

const ALIGN_TO_FLEX = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
} as const;

function resolveCell<T>(
  row: T,
  rowIndex: number,
  col: TableColumn<T>,
): ReactNode {
  if (col.render) return col.render(row, rowIndex);
  const value = (row as Record<string, unknown>)[col.key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function makeKeyOf<T>(rowKey: RowKey<T>): (row: T) => string {
  if (typeof rowKey === "function") return rowKey;
  return (row: T) => String((row as Record<string, unknown>)[rowKey as string]);
}

function toKeySet(input: string | string[] | undefined): Set<string> | "all" {
  if (input === undefined) return "all";
  return new Set(Array.isArray(input) ? input : [input]);
}

// ────────────────────────────────────────────────────────────────────
// Cell + Row (memoized)
// ────────────────────────────────────────────────────────────────────

function Cell({
  width,
  align = "left",
  children,
  bold = false,
  variant,
}: {
  width: number;
  align?: "left" | "center" | "right";
  children: ReactNode;
  bold?: boolean;
  variant?: "muted" | "subtle" | "accent" | "body";
}) {
  return (
    <Box
      variant="transparent"
      style={{
        width,
        flexDirection: "row",
        justifyContent: ALIGN_TO_FLEX[align],
      }}
    >
      <Text variant={variant ?? "body"} preset={bold ? "label" : undefined}>
        {children}
      </Text>
    </Box>
  );
}

interface RowProps<T> {
  row: T;
  index: number;
  columns: TableColumn<T>[];
  highlighted?: boolean;
  pinned?: boolean;
}

function RowImpl<T>({
  row,
  index,
  columns,
  highlighted,
  pinned,
}: RowProps<T>) {
  const cursorMarkerWidth = 2;
  return (
    <Box
      variant={highlighted ? "panel" : "transparent"}
      style={{
        flexDirection: "row",
        gap: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <Box variant="transparent" style={{ width: cursorMarkerWidth }}>
        <Text variant={highlighted ? "accent" : "subtle"}>
          {highlighted ? "▸" : pinned ? "•" : " "}
        </Text>
      </Box>
      {columns.map((col) => (
        <Cell
          key={col.key}
          width={col.width}
          align={col.align}
          variant={highlighted ? "accent" : pinned ? "muted" : "body"}
        >
          {resolveCell(row, index, col)}
        </Cell>
      ))}
    </Box>
  );
}

const Row = memo(RowImpl, (prev, next) => {
  if (prev.row !== next.row) return false;
  if (prev.index !== next.index) return false;
  if (prev.highlighted !== next.highlighted) return false;
  if (prev.pinned !== next.pinned) return false;
  if (prev.columns !== next.columns) return false;
  return true;
}) as typeof RowImpl;

// ────────────────────────────────────────────────────────────────────
// SkeletonRow — placeholder rendered while a row is loading
// ────────────────────────────────────────────────────────────────────

interface SkeletonRowProps<T> {
  columns: TableColumn<T>[];
  /** Renders ▸ if true (e.g. a cursor on a skeleton row). */
  highlighted?: boolean;
}

function SkeletonRowImpl<T>({ columns, highlighted }: SkeletonRowProps<T>) {
  const cursorMarkerWidth = 2;
  return (
    <Box
      variant={highlighted ? "panel" : "transparent"}
      style={{
        flexDirection: "row",
        gap: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <Box variant="transparent" style={{ width: cursorMarkerWidth }}>
        <Text variant={highlighted ? "accent" : "subtle"}>
          {highlighted ? "▸" : " "}
        </Text>
      </Box>
      {columns.map((col) => {
        // Bar of dim chars at ~70% of the column width feels less
        // monolithic than filling the whole cell.
        const barWidth = Math.max(2, Math.floor(col.width * 0.7));
        return (
          <Cell key={col.key} width={col.width} align="left" variant="subtle">
            {"━".repeat(barWidth)}
          </Cell>
        );
      })}
    </Box>
  );
}

const SkeletonRow = memo(SkeletonRowImpl) as typeof SkeletonRowImpl;

// ────────────────────────────────────────────────────────────────────
// HeaderRow (memoized)
// ────────────────────────────────────────────────────────────────────

function HeaderRowImpl<T>({ columns }: { columns: TableColumn<T>[] }) {
  const theme = useThemeTokens();
  const cursorMarkerWidth = 2;
  return (
    <Box variant="transparent" style={{ flexDirection: "column" }}>
      <Box
        variant="transparent"
        style={{
          flexDirection: "row",
          gap: 1,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <Box variant="transparent" style={{ width: cursorMarkerWidth }}>
          <Text variant="subtle"> </Text>
        </Box>
        {columns.map((col) => (
          <Cell key={col.key} width={col.width} align={col.align} bold>
            {col.label}
          </Cell>
        ))}
      </Box>
      <Box variant="transparent" style={{ flexDirection: "row" }}>
        <Text color={theme.colors.border}>
          {"─".repeat(
            cursorMarkerWidth +
              2 +
              columns.reduce((sum, c) => sum + c.width + 1, 0),
          )}
        </Text>
      </Box>
    </Box>
  );
}

const HeaderRow = memo(HeaderRowImpl) as typeof HeaderRowImpl;

// ────────────────────────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────────────────────────

export function Table<T>({
  rows,
  columns,
  rowKey,
  reorder,
  pinHeader = false,
  pinFirstRow = false,
  footerRow,
  selectable = false,
  onChange,
  onSelect,
  onCancel,
  renderDetail,
  detailPosition = "right",
  focusId = "table",
  alwaysCapture = false,
  initialIndex = 0,
  value,
  ref,
  style,
}: TableProps<T>) {
  const { isFocused } = useFocus(focusId);
  const keyOf = useMemo(() => makeKeyOf(rowKey), [rowKey]);

  // Row state (Map preserves insertion order; identity changes only
  // on actual mutations, so React.memo on Row works cleanly).
  const [rowMap, setRowMap] = useState<Map<string, T>>(() => {
    const m = new Map<string, T>();
    for (const r of rows) m.set(keyOf(r), r);
    return m;
  });

  // Loading state per row. Stored separately so toggling skeleton
  // doesn't change the row reference itself.
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [placeholderCount, setPlaceholderCount] = useState(0);

  // Imperative API
  useImperativeHandle(
    ref,
    (): TableHandle<T> => ({
      updateRow(key, update) {
        setRowMap((prev) => {
          const existing = prev.get(key);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(key, { ...existing, ...update });
          return next;
        });
        setLoadingKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      },
      updateRows(updates) {
        setRowMap((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const { key, update } of updates) {
            const existing = next.get(key);
            if (existing) {
              next.set(key, { ...existing, ...update });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        setLoadingKeys((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set(prev);
          let changed = false;
          for (const { key } of updates) {
            if (next.delete(key)) changed = true;
          }
          return changed ? next : prev;
        });
      },
      replaceRow(key, row) {
        setRowMap((prev) => {
          const next = new Map(prev);
          next.set(key, row);
          return next;
        });
        setLoadingKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      },
      upsertRow(row) {
        const k = keyOf(row);
        setRowMap((prev) => {
          const next = new Map(prev);
          next.set(k, row);
          return next;
        });
        setLoadingKeys((prev) => {
          if (!prev.has(k)) return prev;
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      },
      removeRow(key) {
        setRowMap((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        setLoadingKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      },
      replaceAll(newRows) {
        const next = new Map<string, T>();
        for (const r of newRows) next.set(keyOf(r), r);
        setRowMap(next);
        setLoadingKeys(new Set());
        setPlaceholderCount(0);
      },
      markLoading(keyOrKeys) {
        const targets = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          for (const k of targets) next.add(k);
          return next;
        });
      },
      clearLoading(keyOrKeys) {
        const targets = toKeySet(keyOrKeys);
        if (targets === "all") {
          setLoadingKeys((prev) => (prev.size === 0 ? prev : new Set()));
          return;
        }
        setLoadingKeys((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const k of targets) if (next.delete(k)) changed = true;
          return changed ? next : prev;
        });
      },
      setLoadingPlaceholders(count) {
        setPlaceholderCount(Math.max(0, count));
      },
      getRow(key) {
        return rowMap.get(key);
      },
      getRows() {
        return Array.from(rowMap.values());
      },
    }),
    [keyOf, rowMap],
  );

  // Render-order keys. Sorted via the reorder strategy (or insertion
  // order when stable). Re-evaluated on every rowMap change.
  const orderedKeys = useMemo(() => {
    const keys = Array.from(rowMap.keys());
    if (!reorder || reorder.mode === "stable") return keys;
    return [...keys].sort((a, b) => {
      const ra = rowMap.get(a);
      const rb = rowMap.get(b);
      if (ra === undefined || rb === undefined) return 0;
      return reorder.compare(ra, rb);
    });
  }, [rowMap, reorder]);

  const orderedRows = useMemo(
    () => orderedKeys.map((k) => rowMap.get(k)!),
    [orderedKeys, rowMap],
  );

  const bodyStart = pinFirstRow ? 1 : 0;
  const navigableKeys = orderedKeys.slice(bodyStart);
  const navigableRows = orderedRows.slice(bodyStart);

  // Cursor state. We track BOTH the index AND the key the cursor is
  // anchored to. When a sort reorders rows, the cursor follows the
  // key (default) by re-resolving its index, OR stays at the index
  // (cursorFollow === "index") by leaving internalIdx unchanged.
  const cursorFollow =
    reorder && reorder.mode === "sort" ? reorder.cursorFollow ?? "row" : "index";

  const [internalIdx, setInternalIdx] = useState(
    Math.max(
      0,
      Math.min(initialIndex - bodyStart, Math.max(navigableRows.length - 1, 0)),
    ),
  );
  const [anchoredKey, setAnchoredKey] = useState<string | null>(
    () => navigableKeys[internalIdx] ?? null,
  );

  const idx = value !== undefined ? value - bodyStart : internalIdx;

  useEffect(() => {
    if (value !== undefined) setInternalIdx(value - bodyStart);
  }, [value, bodyStart]);

  // Re-anchor cursor when navigableKeys change (sort reorders, deletes,
  // inserts). Two strategies:
  //   "row"   — find the anchored key's new index and follow it.
  //   "index" — leave internalIdx alone; clamp if out of range.
  useEffect(() => {
    if (navigableKeys.length === 0) return;
    if (cursorFollow === "row" && anchoredKey) {
      const newIdx = navigableKeys.indexOf(anchoredKey);
      if (newIdx >= 0 && newIdx !== idx) {
        setInternalIdx(newIdx);
        return;
      }
      // anchored row no longer exists — fall through to clamp
    }
    // Clamp index if it overflows.
    if (idx >= navigableKeys.length) {
      setInternalIdx(navigableKeys.length - 1);
    }
    // Re-sync anchor to whatever's at the current index.
    const currKey = navigableKeys[idx];
    if (currKey && currKey !== anchoredKey) {
      setAnchoredKey(currKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigableKeys, cursorFollow]);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (navigableRows.length === 0) return;
      const next = (idx + delta + navigableRows.length) % navigableRows.length;
      setInternalIdx(next);
      const nextKey = navigableKeys[next];
      if (nextKey) setAnchoredKey(nextKey);
      const row = navigableRows[next];
      if (row !== undefined) onChange?.(row, next + bodyStart);
    },
    [idx, navigableRows, navigableKeys, bodyStart, onChange],
  );

  const enabled = selectable && (isFocused || alwaysCapture);
  useKeybinding("up", "navigate", () => move(-1), { enabled, hidden: true });
  useKeybinding("down", "navigate", () => move(1), { enabled, hidden: true });
  useKeybinding("k", "navigate", () => move(-1), { enabled, hidden: true });
  useKeybinding("j", "navigate", () => move(1), { enabled, hidden: true });
  useKeybinding(
    (k) => k.name === "return" || k.name === "enter",
    "select",
    () => {
      const row = navigableRows[idx];
      if (row !== undefined) onSelect?.(row, idx + bodyStart);
    },
    { enabled, keyDisplay: "↵" },
  );
  useKeybinding("escape", "cancel", () => onCancel?.(), {
    enabled: enabled && Boolean(onCancel),
    keyDisplay: "esc",
  });

  const focusedRow = useMemo(
    () => (selectable ? navigableRows[idx] : undefined),
    [selectable, navigableRows, idx],
  );

  // Render
  const renderBodyRow = (row: T, key: string, i: number) => {
    if (loadingKeys.has(key)) {
      return (
        <SkeletonRow
          key={key}
          columns={columns}
          highlighted={selectable && i === idx}
        />
      );
    }
    return (
      <Row
        key={key}
        row={row}
        index={i + bodyStart}
        columns={columns}
        highlighted={selectable && i === idx}
      />
    );
  };

  const tableContent = (
    <Box
      variant="transparent"
      style={{ flexDirection: "column", gap: 0, ...style }}
    >
      {pinHeader ? <HeaderRow columns={columns} /> : null}

      {pinFirstRow && orderedRows.length > 0 ? (
        loadingKeys.has(orderedKeys[0]!) ? (
          <SkeletonRow key={orderedKeys[0]} columns={columns} />
        ) : (
          <Row
            key={orderedKeys[0]!}
            row={orderedRows[0]!}
            index={0}
            columns={columns}
            pinned
          />
        )
      ) : null}

      <Box variant="transparent" style={{ flexDirection: "column" }}>
        {navigableRows.map((row, i) =>
          renderBodyRow(row, navigableKeys[i]!, i),
        )}

        {/* Synthetic skeleton placeholders for "loading more" UX. */}
        {Array.from({ length: placeholderCount }).map((_, i) => (
          <SkeletonRow
            key={`__skel_${i}`}
            columns={columns}
          />
        ))}
      </Box>

      {footerRow ? (
        <Row
          key="__footer__"
          row={footerRow}
          index={orderedRows.length}
          columns={columns}
          pinned
        />
      ) : null}
    </Box>
  );

  if (!renderDetail || !selectable) return tableContent;

  const detailPane = focusedRow ? (
    <Box variant="panel" padding="md" style={{ flexDirection: "column" }}>
      {renderDetail(focusedRow, idx + bodyStart)}
    </Box>
  ) : null;

  return (
    <Box
      variant="transparent"
      style={{
        flexDirection: detailPosition === "bottom" ? "column" : "row",
        gap: 1,
      }}
    >
      {tableContent}
      {detailPane}
    </Box>
  );
}
