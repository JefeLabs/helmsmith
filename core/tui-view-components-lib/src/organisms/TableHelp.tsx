/**
 * `<TableHelp>` — column-reference help page tied to a `<Table>`
 * instance. Reads the same `TableColumn[]` array and renders a
 * 2-column reference: column label → description.
 *
 * Pattern: a Table whose data IS another Table's column metadata.
 *
 * Usage:
 *
 *   const columns: TableColumn<User>[] = [
 *     { key: "name", label: "Name", width: 24,
 *       description: "The user's display name. Falls back to login." },
 *     { key: "role", label: "Role", width: 12,
 *       description: "admin / member / viewer. Drives access control." },
 *   ];
 *
 *   const [helpOpen, setHelpOpen] = useState(false);
 *   useKeybinding("?", "help", () => setHelpOpen(o => !o));
 *
 *   <Table columns={columns} rows={...} rowKey="id" />
 *   {helpOpen && (
 *     <TableHelp
 *       columns={columns}
 *       onClose={() => setHelpOpen(false)}
 *     />
 *   )}
 *
 * Authoring docs in the same `columns` array keeps them co-located —
 * no separate doc source to drift from the runtime config.
 */

import { useKeybinding } from "../keyboard/registry.tsx";
import { Table, type TableColumn } from "./Table.tsx";

export interface TableHelpProps<T> {
  /** The columns to document. Same array passed to `<Table columns={...}>`. */
  columns: TableColumn<T>[];
  /** Title for the help panel. Default: "Column reference". */
  title?: string;
  /** Width of the "Column" name column. Default: 22. */
  labelWidth?: number;
  /** Width of the "Description" column. Default: 60. */
  descriptionWidth?: number;
  /** Optional pre-amble text rendered above the column list. */
  intro?: string;
  /** When provided, registers an exit keybinding (default: "escape"). */
  onClose?: () => void;
  /** Override the close keybinding. Default: "escape". */
  closeKey?: string;
}

interface HelpRow {
  id: string;
  column: string;
  type: string;
  description: string;
}

const HELP_COLUMNS_BASE = [
  {
    key: "column",
    label: "Column",
    description: "The header label as it appears in the data table.",
  },
  {
    key: "type",
    label: "Type",
    description: "Width and alignment hints from the column definition.",
  },
  {
    key: "description",
    label: "Description",
    description: "What the column displays and how it should be read.",
  },
] as const;

function describeType<T>(col: TableColumn<T>): string {
  const align = col.align ?? "left";
  return `w=${col.width} · ${align}`;
}

export function TableHelp<T>({
  columns,
  title = "Column reference",
  labelWidth = 22,
  descriptionWidth = 60,
  intro,
  onClose,
  closeKey = "escape",
}: TableHelpProps<T>) {
  // Register the close keybinding (only when onClose is provided).
  useKeybinding(
    closeKey,
    "close help",
    () => onClose?.(),
    { hidden: !onClose, keyDisplay: closeKey === "escape" ? "esc" : closeKey },
  );

  const helpRows: HelpRow[] = columns.map((col) => ({
    id: col.key,
    column: col.label,
    type: describeType(col),
    description: col.description ?? "(no description)",
  }));

  const helpColumns: TableColumn<HelpRow>[] = [
    { key: "column", label: "Column", width: labelWidth },
    { key: "type", label: "Type", width: 14 },
    { key: "description", label: "Description", width: descriptionWidth },
  ];

  // If intro is provided, prepend a synthetic row showing it spanning
  // all columns. (Pinning a "first row" via pinFirstRow could also
  // work; we keep it simple and just include it inline.)
  const rowsWithIntro: HelpRow[] = intro
    ? [
        {
          id: "__intro__",
          column: "About",
          type: "",
          description: intro,
        },
        ...helpRows,
      ]
    : helpRows;

  return (
    <Table
      rows={rowsWithIntro}
      columns={helpColumns}
      rowKey="id"
      pinHeader
      pinFirstRow={Boolean(intro)}
    />
  );
}
