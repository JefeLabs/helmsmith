import { writeFile } from "node:fs/promises";
import { queryRecords, loadEnrichmentsSQL, getEnrichmentSQL } from "../store/sqlite-store.js";
import { filterRecords, type Filters } from "../aggregator/filters.js";
import { calculateSegments, type Segment, type SegmentThresholds } from "../aggregator/segments.js";
import { testPct } from "../aggregator/metrics.js";
import type { UserWeekRepoRecord, EnrichmentStore } from "../types/schema.js";

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
  // Enrichment metrics (from gitradar enrich)
  "prs_opened",
  "prs_merged",
  "avg_cycle_hrs",
  "reviews_given",
  "churn_rate_pct",
  // Segmentation (computed at export time)
  "segment",
];

export function flattenRecord(
  r: UserWeekRepoRecord,
  enrichmentStore?: EnrichmentStore,
  segmentMap?: Map<string, Segment>,
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

  // test% — canonical calculation from metrics module
  flat.test_pct = testPct(r.filetype);

  // Enrichment metrics (default to 0 if not enriched)
  if (enrichmentStore) {
    const key = `${r.member}::${r.week}::${r.repo}`;
    const defaultMetrics = { prs_opened: 0, prs_merged: 0, avg_cycle_hrs: 0, reviews_given: 0, churn_rate_pct: 0 };
    const e = enrichmentStore?.enrichments[key] ?? defaultMetrics;
    flat.prs_opened = e.prs_opened;
    flat.prs_merged = e.prs_merged;
    flat.avg_cycle_hrs = e.avg_cycle_hrs;
    flat.reviews_given = e.reviews_given;
    flat.churn_rate_pct = e.churn_rate_pct;
  } else {
    flat.prs_opened = 0;
    flat.prs_merged = 0;
    flat.avg_cycle_hrs = 0;
    flat.reviews_given = 0;
    flat.churn_rate_pct = 0;
  }

  flat.segment = segmentMap?.get(r.member) ?? '';

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

export function recordsToCsv(records: UserWeekRepoRecord[], enrichmentStore?: EnrichmentStore, segmentThresholds?: SegmentThresholds): string {
  // Pre-compute segment map from total lines touched per member across all records
  const memberTotals = new Map<string, number>();
  for (const r of records) {
    const total = Object.values(r.filetype).reduce(
      (s, ft) => s + ft.insertions + ft.deletions, 0,
    );
    memberTotals.set(r.member, (memberTotals.get(r.member) ?? 0) + total);
  }
  const segmentMap = calculateSegments(memberTotals, segmentThresholds);

  const rows = records.map((r) => {
    const flat = flattenRecord(r, enrichmentStore, segmentMap);
    return HEADERS.map((h) => escapeCsvField(flat[h])).join(",");
  });
  return [HEADERS.join(","), ...rows].join("\n") + "\n";
}

export async function exportData(options: ExportDataOptions): Promise<void> {
  let records = queryRecords({});

  if (options.filters) {
    records = filterRecords(records, options.filters);
  }

  if (records.length === 0) {
    console.error('No records to export. Run "gitradar scan" first.');
    process.exitCode = 1;
    return;
  }

  const enrichmentStore = loadEnrichmentsSQL();
  const csv = recordsToCsv(records, enrichmentStore);

  if (options.output) {
    await writeFile(options.output, csv, "utf-8");
    console.log(`Exported ${records.length} records to ${options.output}`);
  } else {
    process.stdout.write(csv);
  }
}
