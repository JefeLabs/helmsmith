import { writeFile } from "node:fs/promises";
import { loadCommitsData } from "../store/commits-by-filetype.js";
import { filterRecords, type Filters } from "../aggregator/filters.js";
import type { UserWeekRepoRecord } from "../types/schema.js";

export interface ExportDataOptions {
  output?: string;
  filters?: Filters;
}

// ── Row flattening ──────────────────────────────────────────────────────────

const FILETYPE_CATEGORIES = ["app", "test", "config", "storybook", "doc"] as const;

/**
 * Column order: identity → dimensions → summary metrics → lines-touched
 * per filetype → detailed filetype breakdown.
 *
 * Summary columns come first so an Excel user can immediately pivot
 * without scrolling past 20 detail columns.
 */
const HEADERS = [
  // Identity
  "member",
  "email",
  "org",
  "org_type",
  "team",
  "tag",
  // Dimensions
  "week",
  "repo",
  "group",
  // Summary metrics (match TUI columns: +ins, -del, net, tst%, cmts, days)
  "commits",
  "active_days",
  "total_insertions",
  "total_deletions",
  "net_lines",
  "total_files",
  "test_pct",
  // Lines touched per filetype (match TUI stacked bars)
  "app_lines",
  "test_lines",
  "config_lines",
  "storybook_lines",
  "doc_lines",
  // Detailed per-filetype breakdown
  "app_files",
  "app_insertions",
  "app_deletions",
  "test_files",
  "test_insertions",
  "test_deletions",
  "config_files",
  "config_insertions",
  "config_deletions",
  "storybook_files",
  "storybook_insertions",
  "storybook_deletions",
  "doc_files",
  "doc_insertions",
  "doc_deletions",
];

export function flattenRecord(
  r: UserWeekRepoRecord,
): Record<string, string | number> {
  const flat: Record<string, string | number> = {
    member: r.member,
    email: r.email,
    org: r.org,
    org_type: r.orgType,
    team: r.team,
    tag: r.tag,
    week: r.week,
    repo: r.repo,
    group: r.group,
    commits: r.commits,
    active_days: r.activeDays,
  };

  let totalIns = 0;
  let totalDel = 0;
  let totalFiles = 0;

  const emptyMetrics = { files: 0, insertions: 0, deletions: 0 };
  for (const cat of FILETYPE_CATEGORIES) {
    const m = r.filetype[cat] ?? emptyMetrics;
    flat[`${cat}_files`] = m.files;
    flat[`${cat}_insertions`] = m.insertions;
    flat[`${cat}_deletions`] = m.deletions;

    const lines = m.insertions + m.deletions;
    flat[`${cat}_lines`] = lines;

    totalIns += m.insertions;
    totalDel += m.deletions;
    totalFiles += m.files;
  }

  flat.total_insertions = totalIns;
  flat.total_deletions = totalDel;
  flat.net_lines = totalIns - totalDel;
  flat.total_files = totalFiles;

  // test% = test lines / (app + test) lines — matches TUI tst% column
  const appLines = flat.app_lines as number;
  const testLines = flat.test_lines as number;
  const denom = appLines + testLines;
  flat.test_pct = denom > 0 ? Math.round((testLines / denom) * 100) : 0;

  return flat;
}

// ── CSV generation ──────────────────────────────────────────────────────────

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function recordsToCsv(records: UserWeekRepoRecord[]): string {
  const rows = records.map((r) => {
    const flat = flattenRecord(r);
    return HEADERS.map((h) => escapeCsvField(flat[h])).join(",");
  });
  return [HEADERS.join(","), ...rows].join("\n") + "\n";
}

export async function exportData(options: ExportDataOptions): Promise<void> {
  const data = await loadCommitsData();
  let records = data.records;

  if (options.filters) {
    records = filterRecords(records, options.filters);
  }

  if (records.length === 0) {
    console.error('No records to export. Run "gitradar scan" first.');
    process.exitCode = 1;
    return;
  }

  const csv = recordsToCsv(records);

  if (options.output) {
    await writeFile(options.output, csv, "utf-8");
    console.log(`Exported ${records.length} records to ${options.output}`);
  } else {
    process.stdout.write(csv);
  }
}
