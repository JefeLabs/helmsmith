import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UserWeekRepoRecord } from "../types/schema.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../store/sqlite-store.js", () => ({
  queryRecords: vi.fn(() => []),
  loadEnrichmentsSQL: vi.fn(() => ({ version: 1, lastUpdated: new Date().toISOString(), enrichments: {} })),
  getEnrichmentSQL: vi.fn(),
}));

import { queryRecords } from "../store/sqlite-store.js";
import {
  flattenRecord,
  recordsToCsv,
  exportData,
} from "../commands/export-data.js";

const mockQueryRecords = vi.mocked(queryRecords);

// ── Test Fixtures ────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<UserWeekRepoRecord> = {},
): UserWeekRepoRecord {
  return {
    member: "Alice",
    email: "alice@example.com",
    org: "Acme",
    orgType: "core",
    team: "frontend",
    tag: "default",
    week: "2026-W08",
    repo: "web-app",
    group: "default",
    commits: 10,
    activeDays: 3,
    filetype: {
      app: { files: 5, filesAdded: 2, filesDeleted: 0, insertions: 120, deletions: 30 },
      test: { files: 2, filesAdded: 1, filesDeleted: 0, insertions: 40, deletions: 5 },
      config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 3, deletions: 1 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

// ── flattenRecord ────────────────────────────────────────────────────────────

describe("flattenRecord", () => {
  it("preserves identity and dimension fields", () => {
    const flat = flattenRecord(makeRecord());

    expect(flat.member).toBe("Alice");
    expect(flat.email).toBe("alice@example.com");
    expect(flat.org).toBe("Acme");
    expect(flat.org_type).toBe("core");
    expect(flat.team).toBe("frontend");
    expect(flat.tag).toBe("default");
    expect(flat.week).toBe("2026-W08");
    expect(flat.repo).toBe("web-app");
    expect(flat.group).toBe("default");
  });

  it("computes total_insertions across all filetypes", () => {
    const flat = flattenRecord(makeRecord());
    // app: 120 + test: 40 + config: 3 + storybook: 0
    expect(flat.total_insertions).toBe(163);
  });

  it("computes total_deletions across all filetypes", () => {
    const flat = flattenRecord(makeRecord());
    // app: 30 + test: 5 + config: 1 + storybook: 0
    expect(flat.total_deletions).toBe(36);
  });

  it("computes net_lines as insertions minus deletions", () => {
    const flat = flattenRecord(makeRecord());
    expect(flat.net_lines).toBe(163 - 36);
  });

  it("computes total_files across all filetypes", () => {
    const flat = flattenRecord(makeRecord());
    // app: 5 + test: 2 + config: 1 + storybook: 0
    expect(flat.total_files).toBe(8);
  });

  it("computes lines-touched per filetype (ins + del)", () => {
    const flat = flattenRecord(makeRecord());

    expect(flat.app_lines).toBe(120 + 30);     // 150
    expect(flat.test_lines).toBe(40 + 5);       // 45
    expect(flat.config_lines).toBe(3 + 1);      // 4
    expect(flat.storybook_lines).toBe(0);
    expect(flat.doc_lines).toBe(0);
  });

  it("computes test_pct as test_lines / (app_lines + test_lines)", () => {
    const flat = flattenRecord(makeRecord());
    // test: 45, app: 150 → 45 / 195 ≈ 23%
    expect(flat.test_pct).toBe(23);
  });

  it("returns test_pct 0 when no app or test lines", () => {
    const record = makeRecord();
    record.filetype.app = { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 };
    record.filetype.test = { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 };

    const flat = flattenRecord(record);
    expect(flat.test_pct).toBe(0);
  });

  it("includes per-filetype detail columns", () => {
    const flat = flattenRecord(makeRecord());

    expect(flat.app_files).toBe(5);
    expect(flat.app_insertions).toBe(120);
    expect(flat.app_deletions).toBe(30);
    expect(flat.test_files).toBe(2);
    expect(flat.test_insertions).toBe(40);
    expect(flat.test_deletions).toBe(5);
  });
});

// ── recordsToCsv ─────────────────────────────────────────────────────────────

describe("recordsToCsv", () => {
  it("produces header row followed by data rows", () => {
    const csv = recordsToCsv([makeRecord()]);
    const lines = csv.trimEnd().split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^member,email,org,/);
  });

  it("includes repo and group columns", () => {
    const csv = recordsToCsv([makeRecord()]);
    const header = csv.split("\n")[0];

    expect(header).toContain("repo");
    expect(header).toContain("group");
  });

  it("includes computed summary columns", () => {
    const csv = recordsToCsv([makeRecord()]);
    const header = csv.split("\n")[0];

    expect(header).toContain("total_insertions");
    expect(header).toContain("total_deletions");
    expect(header).toContain("net_lines");
    expect(header).toContain("total_files");
    expect(header).toContain("test_pct");
    expect(header).toContain("app_lines");
  });

  it("places summary columns before per-filetype detail", () => {
    const csv = recordsToCsv([makeRecord()]);
    const headers = csv.split("\n")[0].split(",");

    const totalInsIdx = headers.indexOf("total_insertions");
    const appFilesIdx = headers.indexOf("app_files");

    expect(totalInsIdx).toBeLessThan(appFilesIdx);
  });

  it("preserves one row per record (member × week × repo)", () => {
    const csv = recordsToCsv([
      makeRecord({ repo: "web-app" }),
      makeRecord({ repo: "api" }),
    ]);
    const lines = csv.trimEnd().split("\n");

    // header + 2 data rows (one per repo)
    expect(lines).toHaveLength(3);
  });

  it("escapes fields containing commas", () => {
    const csv = recordsToCsv([makeRecord({ member: "Last, First" })]);
    expect(csv).toContain('"Last, First"');
  });

  it("escapes fields containing double quotes", () => {
    const csv = recordsToCsv([makeRecord({ repo: 'my "repo"' })]);
    expect(csv).toContain('"my ""repo"""');
  });

  it("returns only header for empty input", () => {
    const csv = recordsToCsv([]);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
  });
});

// ── exportData ───────────────────────────────────────────────────────────────

describe("exportData", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("writes CSV to stdout when no output path given", async () => {
    mockQueryRecords.mockReturnValue([makeRecord()]);

    await exportData({});

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain("member,email,org,");
    expect(output).toContain("Alice");
    expect(output).toContain("web-app");
  });

  it("preserves all records (no aggregation)", async () => {
    mockQueryRecords.mockReturnValue([
      makeRecord({ repo: "web-app" }),
      makeRecord({ repo: "api" }),
    ]);

    await exportData({});

    const output = stdoutSpy.mock.calls[0][0] as string;
    const lines = output.trimEnd().split("\n");
    // header + 2 rows
    expect(lines).toHaveLength(3);
    expect(output).toContain("web-app");
    expect(output).toContain("api");
  });

  it("applies filters before exporting", async () => {
    mockQueryRecords.mockReturnValue([
      makeRecord({ member: "Alice", team: "frontend" }),
      makeRecord({ member: "Bob", team: "backend" }),
    ]);

    await exportData({ filters: { team: "frontend" } });

    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain("Alice");
    expect(output).not.toContain("Bob");
  });

  it("shows error when no records exist", async () => {
    mockQueryRecords.mockReturnValue([]);

    await exportData({});

    expect(stderrSpy).toHaveBeenCalledWith(
      'No records to export. Run "gitradar scan" first.',
    );
    expect(process.exitCode).toBe(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("shows error when all records are filtered out", async () => {
    mockQueryRecords.mockReturnValue([makeRecord({ team: "frontend" })]);

    await exportData({ filters: { team: "nonexistent" } });

    expect(stderrSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
