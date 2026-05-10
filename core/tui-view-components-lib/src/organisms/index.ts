/**
 * Organisms — complex UI components with meaningful internal state
 * and orchestration. Each organism composes atoms and molecules to
 * deliver a self-contained interactive widget.
 *
 *   StatusList     iterates items with status icons (read-only)
 *   SelectList     keyboard-navigable single-select
 *   Confirm        yes/no modal with focus trap
 *   Table          tabular data with sort, focus, ref API, skeleton,
 *                  master/detail
 *   TableHelp      column-reference help page tied to a Table's
 *                  `columns` array (auto-renders from `description`)
 *   ThemeSwitcher  theme-picker overlay
 *   Menu           hierarchical nav with stacked-breadcrumb submenus,
 *                  tab navigation, configurable exit hotkey
 *
 * Per Atomic Design: organisms are where meaningful interaction
 * lives. They're the largest unit before assembly into templates
 * and pages.
 */

export { StatusList } from "./StatusList.tsx";
export type {
  StatusListProps,
  StatusListItem,
  StatusListItemState,
} from "./StatusList.tsx";

export { SelectList } from "./SelectList.tsx";
export type { SelectListProps, SelectListItem } from "./SelectList.tsx";

export { Confirm } from "./Confirm.tsx";
export type { ConfirmProps } from "./Confirm.tsx";

export { Table } from "./Table.tsx";
export type {
  TableProps,
  TableColumn,
  TableHandle,
  TableReorderStrategy,
  RowKey,
} from "./Table.tsx";

export { TableHelp } from "./TableHelp.tsx";
export type { TableHelpProps } from "./TableHelp.tsx";

export { ThemeSwitcher } from "./ThemeSwitcher.tsx";
export type { ThemeSwitcherProps } from "./ThemeSwitcher.tsx";

export { Menu } from "./Menu.tsx";
export type { MenuProps, MenuItem } from "./Menu.tsx";
