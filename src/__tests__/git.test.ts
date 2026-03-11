import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthorMap, ResolvedAuthor } from "../collector/author-map.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRaw = vi.fn();

vi.mock("simple-git", () => {
  const factory = vi.fn(() => ({
    raw: mockRaw,
  }));
  return {
    default: factory,
    simpleGit: factory,
  };
});

vi.mock("../collector/classifier.js", () => ({
  classifyFile: vi.fn((filePath: string) => {
    if (filePath.includes(".test.")) return "test";
    if (filePath.includes(".stories.")) return "storybook";
    if (filePath.endsWith(".json") || filePath.endsWith(".yml")) return "config";
    return "app";
  }),
  buildIgnoreMatcher: vi.fn(() => () => false),
  DEFAULT_IGNORE_PATTERNS: [],
}));

const { parseGitLogOutput, getISOWeek, scanRepo, generateDateChunks, parseChurnLog, sampleEvenly } = await import(
  "../collector/git.js"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAuthorMap(): AuthorMap {
  const alice: ResolvedAuthor = {
    member: "Alice Johnson",
    email: "alice@acme.com",
    org: "Acme Corp",
    orgType: "core",
    team: "Platform",
    tag: "infra",
  };
  const bob: ResolvedAuthor = {
    member: "Bob Smith",
    email: "bob@acme.com",
    org: "Acme Corp",
    orgType: "core",
    team: "Platform",
    tag: "infra",
  };

  const map: AuthorMap = new Map();
  map.set("alice@acme.com", alice);
  map.set("alice johnson", alice);
  map.set("bob@acme.com", bob);
  map.set("bob smith", bob);
  return map;
}

// ── parseGitLogOutput ──────────────────────────────────────────────────────

describe("parseGitLogOutput", () => {
  it("parses a single commit with numstat lines", () => {
    const output = [
      "abc123|alice@acme.com|Alice Johnson|2026-02-20T10:00:00Z",
      "10\t2\tsrc/index.ts",
      "5\t1\tsrc/utils.ts",
    ].join("\n");

    const commits = parseGitLogOutput(output);

    expect(commits).toHaveLength(1);
    expect(commits[0].hash).toBe("abc123");
    expect(commits[0].email).toBe("alice@acme.com");
    expect(commits[0].name).toBe("Alice Johnson");
    expect(commits[0].date).toBe("2026-02-20T10:00:00Z");
    expect(commits[0].files).toHaveLength(2);
    expect(commits[0].files[0]).toEqual({
      insertions: 10,
      deletions: 2,
      path: "src/index.ts",
      status: "unknown",
    });
    expect(commits[0].files[1]).toEqual({
      insertions: 5,
      deletions: 1,
      path: "src/utils.ts",
      status: "unknown",
    });
  });

  it("parses multiple commits separated by blank lines", () => {
    const output = [
      "aaa111|alice@acme.com|Alice|2026-02-20T10:00:00Z",
      "10\t2\tsrc/a.ts",
      "",
      "bbb222|bob@acme.com|Bob|2026-02-21T10:00:00Z",
      "3\t1\tsrc/b.ts",
    ].join("\n");

    const commits = parseGitLogOutput(output);

    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe("aaa111");
    expect(commits[1].hash).toBe("bbb222");
  });

  it("handles binary files (- for insertions/deletions)", () => {
    const output = [
      "ccc333|alice@acme.com|Alice|2026-02-22T10:00:00Z",
      "-\t-\timage.png",
    ].join("\n");

    const commits = parseGitLogOutput(output);

    expect(commits).toHaveLength(1);
    expect(commits[0].files[0]).toEqual({
      insertions: 0,
      deletions: 0,
      path: "image.png",
      status: "unknown",
    });
  });

  it("returns empty array for empty output", () => {
    expect(parseGitLogOutput("")).toEqual([]);
    expect(parseGitLogOutput("  \n  ")).toEqual([]);
  });

  it("handles commits with no file changes", () => {
    const output = [
      "ddd444|alice@acme.com|Alice|2026-02-23T10:00:00Z",
      "",
      "eee555|bob@acme.com|Bob|2026-02-24T10:00:00Z",
    ].join("\n");

    const commits = parseGitLogOutput(output);

    expect(commits).toHaveLength(2);
    expect(commits[0].files).toEqual([]);
    expect(commits[1].files).toEqual([]);
  });

  it("handles trailing newline", () => {
    const output = [
      "fff666|alice@acme.com|Alice|2026-02-25T10:00:00Z",
      "1\t0\tsrc/file.ts",
      "",
    ].join("\n");

    const commits = parseGitLogOutput(output);

    expect(commits).toHaveLength(1);
    expect(commits[0].files).toHaveLength(1);
  });

  it("parses --raw + --numstat combined output with file status", () => {
    const output = [
      "abc123|alice@acme.com|Alice|2026-02-20T10:00:00Z",
      "",
      ":100644 000000 47ee3d55 00000000 D\t.changeset/old.md",
      ":000000 100644 00000000 aabb1122 A\tsrc/new-file.ts",
      ":100644 100644 059ef058 740414aa M\tsrc/index.ts",
      "",
      "0\t6\t.changeset/old.md",
      "50\t0\tsrc/new-file.ts",
      "10\t3\tsrc/index.ts",
    ].join("\n");

    const commits = parseGitLogOutput(output);

    expect(commits).toHaveLength(1);
    expect(commits[0].files).toHaveLength(3);
    expect(commits[0].files[0]).toEqual({
      insertions: 0, deletions: 6, path: ".changeset/old.md", status: "D",
    });
    expect(commits[0].files[1]).toEqual({
      insertions: 50, deletions: 0, path: "src/new-file.ts", status: "A",
    });
    expect(commits[0].files[2]).toEqual({
      insertions: 10, deletions: 3, path: "src/index.ts", status: "M",
    });
  });
});

// ── getISOWeek ─────────────────────────────────────────────────────────────

describe("getISOWeek", () => {
  it("returns correct ISO week for a known date", () => {
    // 2026-02-25 is a Wednesday in Week 9 of 2026
    expect(getISOWeek("2026-02-25T10:00:00Z")).toBe("2026-W09");
  });

  it("handles January 1 correctly (may be previous year's last week)", () => {
    // 2026-01-01 is a Thursday → W01 of 2026
    expect(getISOWeek("2026-01-01T00:00:00Z")).toBe("2026-W01");
  });

  it("returns correct week at year boundary", () => {
    // 2025-12-29 is a Monday → W52 of 2025
    expect(getISOWeek("2025-12-29T00:00:00Z")).toBe("2025-W52");
  });

  it("handles week 1 of new year", () => {
    // 2026-01-05 is a Monday → W01 of 2026
    expect(getISOWeek("2026-01-05T00:00:00Z")).toBe("2026-W01");
  });

  it("handles mid-year dates", () => {
    // 2026-06-15 is a Monday → W24
    expect(getISOWeek("2026-06-15T00:00:00Z")).toBe("2026-W24");
  });
});

// ── scanRepo ────────────────────────────────────────────────────────────────

describe("scanRepo", () => {
  beforeEach(() => {
    mockRaw.mockReset();
  });

  it("produces records for resolved authors", async () => {
    mockRaw.mockResolvedValue(
      [
        "aaa111|alice@acme.com|Alice Johnson|2026-02-20T10:00:00Z",
        "10\t2\tsrc/index.ts",
        "5\t1\tsrc/utils.test.ts",
      ].join("\n")
    );

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
    });

    expect(result.commitCount).toBe(1);
    expect(result.newRecords).toHaveLength(1);
    expect(result.newHashes).toEqual(["aaa111"]);

    const record = result.newRecords[0];
    expect(record.member).toBe("Alice Johnson");
    expect(record.repo).toBe("frontend");
    expect(record.group).toBe("web");
    expect(record.commits).toBe(1);
    expect(record.filetype.app.insertions).toBe(10);
    expect(record.filetype.test.insertions).toBe(5);
  });

  it("skips commits already in recentHashes", async () => {
    mockRaw.mockResolvedValue(
      [
        "aaa111|alice@acme.com|Alice Johnson|2026-02-20T10:00:00Z",
        "10\t2\tsrc/index.ts",
        "",
        "bbb222|bob@acme.com|Bob Smith|2026-02-21T10:00:00Z",
        "3\t1\tsrc/other.ts",
      ].join("\n")
    );

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(["aaa111"]),
    });

    expect(result.commitCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(result.newHashes).toEqual(["bbb222"]);
    expect(result.newRecords).toHaveLength(1);
    expect(result.newRecords[0].member).toBe("Bob Smith");
  });

  it("assigns unresolved authors to 'unassigned' org/team", async () => {
    mockRaw.mockResolvedValue(
      [
        "ccc333|unknown@nowhere.com|Unknown Person|2026-02-22T10:00:00Z",
        "10\t2\tsrc/mystery.ts",
      ].join("\n")
    );

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
    });

    expect(result.commitCount).toBe(1);
    expect(result.newHashes).toEqual(["ccc333"]);
    expect(result.newRecords).toHaveLength(1);
    expect(result.newRecords[0].member).toBe("Unknown Person");
    expect(result.newRecords[0].org).toBe("unassigned");
    expect(result.newRecords[0].team).toBe("unassigned");
  });

  it("aggregates multiple commits by same author in same week", async () => {
    mockRaw.mockResolvedValue(
      [
        "aaa111|alice@acme.com|Alice Johnson|2026-02-23T10:00:00Z",
        "10\t2\tsrc/a.ts",
        "",
        "bbb222|alice@acme.com|Alice Johnson|2026-02-24T14:00:00Z",
        "5\t1\tsrc/b.ts",
      ].join("\n")
    );

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
    });

    expect(result.newRecords).toHaveLength(1);
    const record = result.newRecords[0];
    expect(record.commits).toBe(2);
    expect(record.filetype.app.insertions).toBe(15);
    expect(record.filetype.app.deletions).toBe(3);
    expect(record.activeDays).toBe(2);
  });

  it("passes since option to git log args", async () => {
    mockRaw.mockResolvedValue("");

    await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
      since: "2026-02-01",
    });

    expect(mockRaw).toHaveBeenCalledWith(
      expect.arrayContaining(["--since=2026-02-01"])
    );
  });

  it("handles git errors gracefully", async () => {
    mockRaw.mockRejectedValue(new Error("not a git repository"));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await scanRepo("/repos/broken", {
      repoName: "broken",
      group: "default",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
    });

    expect(result.commitCount).toBe(0);
    expect(result.newRecords).toEqual([]);
    expect(result.newHashes).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("git error")
    );

    consoleSpy.mockRestore();
  });

  it("caps activeDays at 7", async () => {
    // Create 8 commits on different days in the same week
    // Week 9 of 2026: Mon Feb 23 to Sun Mar 1
    const lines: string[] = [];
    for (let day = 0; day < 8; day++) {
      const d = 23 + day; // Feb 23-28 + Mar 1-2 (but let's keep in same week range)
      const hash = `h${String(day).padStart(3, "0")}`;
      const dateStr = day < 6
        ? `2026-02-${String(d).padStart(2, "0")}T10:00:00Z`
        : `2026-03-0${day - 5}T10:00:00Z`;
      lines.push(`${hash}|alice@acme.com|Alice Johnson|${dateStr}`);
      lines.push("1\t0\tsrc/file.ts");
      if (day < 7) lines.push("");
    }
    mockRaw.mockResolvedValue(lines.join("\n"));

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
    });

    // activeDays should be capped at 7
    for (const record of result.newRecords) {
      expect(record.activeDays).toBeLessThanOrEqual(7);
    }
  });

  it("scans in time-based chunks when chunkMonths is set and no since", async () => {
    // Each call to git.raw returns different commits
    mockRaw
      .mockResolvedValueOnce(
        "aaa111|alice@acme.com|Alice Johnson|2024-03-15T10:00:00Z\n5\t1\tsrc/a.ts"
      )
      .mockResolvedValueOnce(
        "bbb222|alice@acme.com|Alice Johnson|2024-06-20T10:00:00Z\n3\t0\tsrc/b.ts"
      )
      .mockResolvedValue(""); // remaining empty chunks

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
      chunkMonths: 3,
    });

    // Should have called git.raw multiple times (one per 3-month chunk)
    expect(mockRaw.mock.calls.length).toBeGreaterThan(1);
    // All git calls should have --since and --until
    for (const call of mockRaw.mock.calls) {
      const args = call[0] as string[];
      expect(args.some((a) => a.startsWith("--since="))).toBe(true);
      expect(args.some((a) => a.startsWith("--until="))).toBe(true);
    }

    // Should still produce merged results across chunks
    expect(result.commitCount).toBe(2);
    expect(result.newHashes).toContain("aaa111");
    expect(result.newHashes).toContain("bbb222");
  });

  it("does not chunk when since is set (incremental scan)", async () => {
    mockRaw.mockResolvedValue("");

    await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
      since: "2026-02-01",
      chunkMonths: 3,
    });

    // Should call git.raw exactly once (no chunking for incremental)
    expect(mockRaw).toHaveBeenCalledTimes(1);
    expect(mockRaw.mock.calls[0][0]).toContain("--since=2026-02-01");
  });

  it("continues scanning remaining chunks when one chunk errors", async () => {
    mockRaw
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValueOnce(
        "ccc333|alice@acme.com|Alice Johnson|2024-06-15T10:00:00Z\n2\t0\tsrc/c.ts"
      )
      .mockResolvedValue("");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
      chunkMonths: 3,
    });

    // Should still get records from the successful chunk
    expect(result.commitCount).toBe(1);
    expect(result.newHashes).toContain("ccc333");
    consoleSpy.mockRestore();
  });
});

// ── generateDateChunks ──────────────────────────────────────────────────────

describe("generateDateChunks", () => {
  it("generates 3-month chunks over a 1-year range", () => {
    const start = new Date("2025-01-01");
    const end = new Date("2026-01-01");
    const chunks = generateDateChunks(start, end, 3);

    expect(chunks).toHaveLength(4);
    expect(chunks[0].since).toBe("2025-01-01");
    expect(chunks[0].until).toBe("2025-04-01");
    expect(chunks[3].since).toBe("2025-10-01");
    expect(chunks[3].until).toBe("2026-01-01");
  });

  it("handles range shorter than chunk size", () => {
    const start = new Date("2026-01-01");
    const end = new Date("2026-02-01");
    const chunks = generateDateChunks(start, end, 3);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].since).toBe("2026-01-01");
  });

  it("returns empty array when start equals end", () => {
    const date = new Date("2026-01-01");
    const chunks = generateDateChunks(date, date, 3);

    expect(chunks).toHaveLength(0);
  });
});

// ── parseChurnLog ──────────────────────────────────────────────────────────

describe("parseChurnLog", () => {
  it("parses single commit with numstat", () => {
    const output = [
      "abc123def456abc123def456abc123def456abc1",
      "10\t5\tsrc/index.ts",
      "3\t1\tsrc/utils.ts",
    ].join("\n");

    const commits = parseChurnLog(output);
    expect(commits).toHaveLength(1);
    expect(commits[0].hash).toBe("abc123def456abc123def456abc123def456abc1");
    expect(commits[0].files).toHaveLength(2);
    expect(commits[0].files[0]).toEqual({ path: "src/index.ts", insertions: 10, deletions: 5 });
    expect(commits[0].files[1]).toEqual({ path: "src/utils.ts", insertions: 3, deletions: 1 });
  });

  it("parses multiple commits", () => {
    const output = [
      "aaaa00000000000000000000000000000000aaaa",
      "5\t2\tsrc/a.ts",
      "",
      "bbbb00000000000000000000000000000000bbbb",
      "3\t1\tsrc/b.ts",
    ].join("\n");

    const commits = parseChurnLog(output);
    expect(commits).toHaveLength(2);
    expect(commits[0].files[0].path).toBe("src/a.ts");
    expect(commits[1].files[0].path).toBe("src/b.ts");
  });

  it("returns empty for empty output", () => {
    expect(parseChurnLog("")).toHaveLength(0);
    expect(parseChurnLog("  \n  ")).toHaveLength(0);
  });

  it("handles binary files (- for insertions/deletions)", () => {
    const output = [
      "cccc00000000000000000000000000000000cccc",
      "-\t-\timage.png",
    ].join("\n");

    const commits = parseChurnLog(output);
    expect(commits[0].files[0]).toEqual({ path: "image.png", insertions: 0, deletions: 0 });
  });
});

// ── sampleEvenly ──────────────────────────────────────────────────────────

describe("sampleEvenly", () => {
  it("returns all items when n >= length", () => {
    const arr = [1, 2, 3];
    expect(sampleEvenly(arr, 5)).toEqual([1, 2, 3]);
    expect(sampleEvenly(arr, 3)).toEqual([1, 2, 3]);
  });

  it("samples evenly from array", () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const sampled = sampleEvenly(arr, 5);
    expect(sampled).toHaveLength(5);
    // Should pick indices 0, 2, 4, 6, 8
    expect(sampled).toEqual([0, 2, 4, 6, 8]);
  });

  it("handles n=1", () => {
    const arr = [10, 20, 30];
    expect(sampleEvenly(arr, 1)).toEqual([10]);
  });
});
