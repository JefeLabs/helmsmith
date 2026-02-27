import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  CommitsByFiletype,
  UserWeekRepoRecord,
} from "../types/schema.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_COMMITS_PATH = "/mock/data/commits-by-filetype.json";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
}));

vi.mock("../store/paths.js", () => ({
  getCommitsPath: () => MOCK_COMMITS_PATH,
  ensureDataDir: vi.fn(async () => undefined),
}));

const { readFile, writeFile, rename } = await import("node:fs/promises");
const { ensureDataDir } = await import("../store/paths.js");

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);
const mockEnsureDataDir = vi.mocked(ensureDataDir);

const {
  loadCommitsData,
  saveCommitsData,
  mergeRecords,
  pruneOldRecords,
  shouldAutoPrune,
  getStoreStats,
} = await import("../store/commits-by-filetype.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFiletype(overrides?: Partial<Record<string, unknown>>) {
  return {
    app: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 200, deletions: 50 },
    test: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 80, deletions: 20 },
    config: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
    storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 10 },
    ...overrides,
  };
}

function makeRecord(
  overrides?: Partial<UserWeekRepoRecord>
): UserWeekRepoRecord {
  return {
    member: "Alice Chen",
    email: "alice@company.com",
    org: "Team A",
    orgType: "core" as const,
    team: "Platform",
    tag: "infrastructure",
    week: "2026-W08",
    repo: "frontend-app",
    group: "web",
    commits: 42,
    activeDays: 5,
    filetype: makeFiletype(),
    ...overrides,
  } as UserWeekRepoRecord;
}

// ── loadCommitsData ──────────────────────────────────────────────────────────

describe("loadCommitsData", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("returns empty data when file does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const data = await loadCommitsData();
    expect(data.version).toBe(1);
    expect(data.records).toEqual([]);
    expect(data.lastUpdated).toBeDefined();
  });

  it("loads and parses existing commits data from disk", async () => {
    const existing: CommitsByFiletype = {
      version: 1,
      lastUpdated: "2026-02-20T10:00:00Z",
      records: [makeRecord()],
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing));
    const data = await loadCommitsData();
    expect(data.version).toBe(1);
    expect(data.records).toHaveLength(1);
    expect(data.records[0].member).toBe("Alice Chen");
  });
});

// ── saveCommitsData ──────────────────────────────────────────────────────────

describe("saveCommitsData", () => {
  beforeEach(() => {
    mockWriteFile.mockReset();
    mockRename.mockReset();
    mockEnsureDataDir.mockReset();
  });

  it("writes to .tmp then renames atomically", async () => {
    const data: CommitsByFiletype = {
      version: 1,
      lastUpdated: "2026-02-20T10:00:00Z",
      records: [makeRecord()],
    };
    await saveCommitsData(data);

    expect(mockEnsureDataDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      MOCK_COMMITS_PATH + ".tmp",
      expect.any(String),
      "utf-8"
    );
    expect(mockRename).toHaveBeenCalledWith(
      MOCK_COMMITS_PATH + ".tmp",
      MOCK_COMMITS_PATH
    );
  });

  it("updates lastUpdated timestamp on save", async () => {
    const data: CommitsByFiletype = {
      version: 1,
      lastUpdated: "2000-01-01T00:00:00Z",
      records: [],
    };

    let savedContent = "";
    mockWriteFile.mockImplementation(
      async (_path, content) => {
        savedContent = content as string;
      }
    );

    await saveCommitsData(data);

    const parsed = JSON.parse(savedContent) as CommitsByFiletype;
    expect(parsed.lastUpdated).not.toBe("2000-01-01T00:00:00Z");
    // Should be a recent ISO string
    const savedDate = new Date(parsed.lastUpdated).getTime();
    expect(savedDate).toBeGreaterThan(Date.now() - 5000);
  });
});

// ── mergeRecords ─────────────────────────────────────────────────────────────

describe("mergeRecords", () => {
  it("sums metrics for records with the same key (member::week::repo)", () => {
    const existing = [makeRecord({ commits: 10, activeDays: 3 })];
    const incoming = [makeRecord({ commits: 5, activeDays: 2 })];

    const merged = mergeRecords(existing, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0].commits).toBe(15);
    expect(merged[0].activeDays).toBe(5);
    // Filetype metrics should also be summed
    expect(merged[0].filetype.app.files).toBe(20);
    expect(merged[0].filetype.app.insertions).toBe(400);
    expect(merged[0].filetype.app.deletions).toBe(100);
  });

  it("caps activeDays at 7 when merging", () => {
    const existing = [makeRecord({ activeDays: 5 })];
    const incoming = [makeRecord({ activeDays: 4 })];

    const merged = mergeRecords(existing, incoming);
    expect(merged[0].activeDays).toBe(7);
  });

  it("keeps records with different keys separate", () => {
    const existing = [makeRecord({ member: "Alice Chen", repo: "repo-a" })];
    const incoming = [makeRecord({ member: "Bob Smith", repo: "repo-b" })];

    const merged = mergeRecords(existing, incoming);
    expect(merged).toHaveLength(2);
  });

  it("does not mutate input arrays", () => {
    const existing = [makeRecord({ commits: 10 })];
    const incoming = [makeRecord({ commits: 5 })];
    const existingCopy = JSON.parse(JSON.stringify(existing));
    const incomingCopy = JSON.parse(JSON.stringify(incoming));

    mergeRecords(existing, incoming);

    expect(existing).toEqual(existingCopy);
    expect(incoming).toEqual(incomingCopy);
  });

  it("handles empty existing array", () => {
    const incoming = [makeRecord()];
    const merged = mergeRecords([], incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].commits).toBe(42);
  });

  it("handles empty incoming array", () => {
    const existing = [makeRecord()];
    const merged = mergeRecords(existing, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].commits).toBe(42);
  });
});

// ── pruneOldRecords ──────────────────────────────────────────────────────────

describe("pruneOldRecords", () => {
  it("filters out records older than weeksBack threshold", () => {
    const records = [
      makeRecord({ week: "2020-W01" }), // very old
      makeRecord({ week: "2026-W07", member: "Bob" }), // recent
      makeRecord({ week: "2026-W08", member: "Carol" }), // recent
    ];

    const pruned = pruneOldRecords(records, 12);
    // Old record should be gone, recent ones kept
    expect(pruned.length).toBeGreaterThanOrEqual(2);
    expect(pruned.every((r) => r.week >= "2025-")).toBe(true);
  });

  it("keeps all records when none are old", () => {
    const records = [
      makeRecord({ week: "2026-W07" }),
      makeRecord({ week: "2026-W08", member: "Bob" }),
    ];

    const pruned = pruneOldRecords(records, 52);
    expect(pruned).toHaveLength(2);
  });

  it("does not mutate input array", () => {
    const records = [makeRecord({ week: "2020-W01" })];
    const copy = [...records];
    pruneOldRecords(records, 12);
    expect(records).toEqual(copy);
  });

  it("returns empty array when all records are old", () => {
    const records = [
      makeRecord({ week: "2020-W01" }),
      makeRecord({ week: "2020-W02", member: "Bob" }),
    ];

    const pruned = pruneOldRecords(records, 1);
    expect(pruned).toHaveLength(0);
  });
});

// ── shouldAutoPrune ──────────────────────────────────────────────────────────

describe("shouldAutoPrune", () => {
  it("returns false for small data", () => {
    const data: CommitsByFiletype = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      records: [makeRecord()],
    };
    expect(shouldAutoPrune(data)).toBe(false);
  });

  it("returns true when record count exceeds 100K", () => {
    const records = Array.from({ length: 100_001 }, (_, i) =>
      makeRecord({ member: `member-${i}`, repo: `repo-${i}` })
    );
    const data: CommitsByFiletype = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      records,
    };
    expect(shouldAutoPrune(data)).toBe(true);
  });
});

// ── getStoreStats ────────────────────────────────────────────────────────────

describe("getStoreStats", () => {
  it("computes correct statistics", () => {
    const records = [
      makeRecord({ org: "Org A", team: "Team 1", week: "2026-W06" }),
      makeRecord({
        org: "Org A",
        team: "Team 2",
        week: "2026-W07",
        member: "Bob",
      }),
      makeRecord({
        org: "Org B",
        team: "Team 3",
        week: "2026-W08",
        member: "Carol",
      }),
    ];
    const data: CommitsByFiletype = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      records,
    };

    const stats = getStoreStats(data);
    expect(stats.recordCount).toBe(3);
    expect(stats.orgCount).toBe(2);
    expect(stats.teamCount).toBe(3);
    expect(stats.oldestWeek).toBe("2026-W06");
    expect(stats.newestWeek).toBe("2026-W08");
  });

  it("returns undefined weeks for empty records", () => {
    const data: CommitsByFiletype = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      records: [],
    };

    const stats = getStoreStats(data);
    expect(stats.recordCount).toBe(0);
    expect(stats.orgCount).toBe(0);
    expect(stats.teamCount).toBe(0);
    expect(stats.oldestWeek).toBeUndefined();
    expect(stats.newestWeek).toBeUndefined();
  });

  it("handles single record", () => {
    const data: CommitsByFiletype = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      records: [makeRecord({ org: "Solo Org", team: "Solo Team", week: "2026-W08" })],
    };

    const stats = getStoreStats(data);
    expect(stats.recordCount).toBe(1);
    expect(stats.orgCount).toBe(1);
    expect(stats.teamCount).toBe(1);
    expect(stats.oldestWeek).toBe("2026-W08");
    expect(stats.newestWeek).toBe("2026-W08");
  });
});
