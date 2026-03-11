import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter, PassThrough } from "node:stream";
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

// Track spawn calls for assertions
const spawnCalls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
// Queue of outputs or errors for successive spawn calls
let spawnQueue: Array<string | Error> = [];

/**
 * Create a fake ChildProcess that emits the given output on stdout,
 * or emits an error + non-zero exit code if given an Error.
 * Uses PassThrough streams so readline can consume them properly.
 */
function createMockChildProcess(outputOrError: string | Error): EventEmitter & { stdout: PassThrough; stderr: PassThrough } {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  // Schedule emission after event loop tick so listeners can attach first
  process.nextTick(() => {
    if (outputOrError instanceof Error) {
      child.stderr.end(outputOrError.message);
      child.stdout.end();
      child.emit("close", 128);
    } else {
      child.stderr.end();
      // Ensure output ends with newline so readline processes the last line
      const data = outputOrError && !outputOrError.endsWith("\n")
        ? outputOrError + "\n"
        : outputOrError;
      child.stdout.end(data);
      child.emit("close", 0);
    }
  });

  return child;
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn((_cmd: string, _args: string[], _opts: Record<string, unknown>) => {
    spawnCalls.push({ cmd: _cmd, args: _args, opts: _opts });
    const outputOrError = spawnQueue.length > 0 ? spawnQueue.shift()! : "";
    return createMockChildProcess(outputOrError);
  }),
}));

vi.mock("../collector/classifier.js", () => ({
  classifyFile: vi.fn((filePath: string) => {
    if (filePath.includes(".test.")) return "test";
    if (filePath.includes(".stories.")) return "storybook";
    if (filePath.endsWith(".json") || filePath.endsWith(".yml")) return "config";
    return "app";
  }),
  buildIgnoreMatcher: vi.fn(() => () => false),
  buildClassifier: vi.fn(() => (filePath: string) => {
    if (filePath.includes(".test.")) return "test";
    if (filePath.includes(".stories.")) return "storybook";
    if (filePath.endsWith(".json") || filePath.endsWith(".yml")) return "config";
    return "app";
  }),
  DEFAULT_IGNORE_PATTERNS: [],
}));

const { parseGitLogOutput, getISOWeek, scanRepo, generateDateChunks, parseChurnLog, sampleEvenly, parseIntent, calculateFastChurnRate, GitLogLineParser, classifyGitError } = await import(
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
    spawnCalls.length = 0;
    spawnQueue = [];
  });

  it("produces records for resolved authors", async () => {
    spawnQueue.push(
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
    spawnQueue.push(
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
    spawnQueue.push(
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
    spawnQueue.push(
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
    spawnQueue.push("");

    await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
      since: "2026-02-01",
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toEqual(
      expect.arrayContaining(["--since=2026-02-01"])
    );
  });

  it("handles fatal git errors gracefully", async () => {
    spawnQueue.push(new Error("not a git repository"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
      expect.stringContaining("not a git repository")
    );

    consoleSpy.mockRestore();
  });

  it("silently handles expected git errors", async () => {
    spawnQueue.push(new Error("does not have any commits yet"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await scanRepo("/repos/empty", {
      repoName: "empty",
      group: "default",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
    });

    expect(result.commitCount).toBe(0);
    expect(result.newRecords).toEqual([]);
    // Expected errors: neither console.log warning nor console.error
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("caps activeDays at 7", async () => {
    // Create 8 commits on different days in the same week
    const lines: string[] = [];
    for (let day = 0; day < 8; day++) {
      const d = 23 + day;
      const hash = `h${String(day).padStart(3, "0")}`;
      const dateStr = day < 6
        ? `2026-02-${String(d).padStart(2, "0")}T10:00:00Z`
        : `2026-03-0${day - 5}T10:00:00Z`;
      lines.push(`${hash}|alice@acme.com|Alice Johnson|${dateStr}`);
      lines.push("1\t0\tsrc/file.ts");
      if (day < 7) lines.push("");
    }
    spawnQueue.push(lines.join("\n"));

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
    // Each spawn call returns different commits; fill queue with enough entries
    spawnQueue.push("aaa111|alice@acme.com|Alice Johnson|2024-03-15T10:00:00Z\n5\t1\tsrc/a.ts");
    spawnQueue.push("bbb222|alice@acme.com|Alice Johnson|2024-06-20T10:00:00Z\n3\t0\tsrc/b.ts");
    // Remaining chunks return empty output (default in mock)

    const result = await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
      chunkMonths: 3,
    });

    // Should have spawned multiple times (one per 3-month chunk)
    expect(spawnCalls.length).toBeGreaterThan(1);
    // All spawn calls should have --since and --until in args
    for (const call of spawnCalls) {
      expect(call.args.some((a) => a.startsWith("--since="))).toBe(true);
      expect(call.args.some((a) => a.startsWith("--until="))).toBe(true);
    }

    // Should still produce merged results across chunks
    expect(result.commitCount).toBe(2);
    expect(result.newHashes).toContain("aaa111");
    expect(result.newHashes).toContain("bbb222");
  });

  it("does not chunk when since is set (incremental scan)", async () => {
    spawnQueue.push("");

    await scanRepo("/repos/frontend", {
      repoName: "frontend",
      group: "web",
      authorMap: makeAuthorMap(),
      recentHashes: new Set(),
      since: "2026-02-01",
      chunkMonths: 3,
    });

    // Should spawn exactly once (no chunking for incremental)
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toContain("--since=2026-02-01");
  });

  it("continues scanning remaining chunks when one chunk errors", async () => {
    spawnQueue.push(new Error("transient failure"));
    spawnQueue.push("ccc333|alice@acme.com|Alice Johnson|2024-06-15T10:00:00Z\n2\t0\tsrc/c.ts");
    // Remaining chunks return empty output (default in mock)

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

// ── parseIntent ──────────────────────────────────────────────────────────────

describe("parseIntent", () => {
  it("parses feat prefix", () => {
    expect(parseIntent("feat: add new button")).toBe("feat");
  });

  it("parses fix prefix", () => {
    expect(parseIntent("fix: resolve null pointer")).toBe("fix");
  });

  it("parses feat with scope", () => {
    expect(parseIntent("feat(auth): add OAuth support")).toBe("feat");
  });

  it("parses refactor prefix", () => {
    expect(parseIntent("refactor: simplify logic")).toBe("refactor");
  });

  it("parses docs prefix", () => {
    expect(parseIntent("docs: update README")).toBe("docs");
  });

  it("parses test prefix", () => {
    expect(parseIntent("test: add unit tests")).toBe("test");
  });

  it("maps tests to test", () => {
    expect(parseIntent("tests: add integration tests")).toBe("test");
  });

  it("parses chore prefix", () => {
    expect(parseIntent("chore: bump deps")).toBe("chore");
  });

  it("maps ci to chore", () => {
    expect(parseIntent("ci: fix pipeline")).toBe("chore");
  });

  it("maps build to chore", () => {
    expect(parseIntent("build: update webpack")).toBe("chore");
  });

  it("maps perf to chore", () => {
    expect(parseIntent("perf: optimize query")).toBe("chore");
  });

  it("handles breaking change indicator", () => {
    expect(parseIntent("feat!: breaking API change")).toBe("feat");
  });

  it("handles breaking change with scope", () => {
    expect(parseIntent("fix(api)!: remove deprecated endpoint")).toBe("fix");
  });

  it("returns other for non-conventional commits", () => {
    expect(parseIntent("Update button styling")).toBe("other");
    expect(parseIntent("WIP")).toBe("other");
    expect(parseIntent("Merge branch 'main'")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(parseIntent("FEAT: uppercase")).toBe("feat");
    expect(parseIntent("Fix: mixed case")).toBe("fix");
  });

  it("handles empty subject", () => {
    expect(parseIntent("")).toBe("other");
  });
});

// ── parseGitLogOutput with subject (5-field format) ──────────────────────────

describe("parseGitLogOutput with subject", () => {
  it("parses 5-field format and extracts intent", () => {
    const output = [
      "abc123|alice@acme.com|Alice|2026-02-20T10:00:00Z|feat: add button",
      "10\t2\tsrc/button.ts",
    ].join("\n");

    const commits = parseGitLogOutput(output);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe("feat: add button");
    expect(commits[0].intent).toBe("feat");
  });

  it("handles subject with pipe characters", () => {
    const output = [
      "abc123|alice@acme.com|Alice|2026-02-20T10:00:00Z|fix: handle a|b case",
      "5\t1\tsrc/utils.ts",
    ].join("\n");

    const commits = parseGitLogOutput(output);
    expect(commits[0].subject).toBe("fix: handle a|b case");
    expect(commits[0].intent).toBe("fix");
  });

  it("falls back to other for non-conventional subject", () => {
    const output = [
      "abc123|alice@acme.com|Alice|2026-02-20T10:00:00Z|Update styling",
      "3\t0\tsrc/style.css",
    ].join("\n");

    const commits = parseGitLogOutput(output);
    expect(commits[0].intent).toBe("other");
  });

  it("still parses old 4-field format", () => {
    const output = [
      "abc123|alice@acme.com|Alice Johnson|2026-02-20T10:00:00Z",
      "10\t2\tsrc/index.ts",
    ].join("\n");

    const commits = parseGitLogOutput(output);
    expect(commits[0].name).toBe("Alice Johnson");
    expect(commits[0].subject).toBe("");
    expect(commits[0].intent).toBe("other");
  });
});

// ── GitLogLineParser (streaming parser) ─────────────────────────────────────

describe("GitLogLineParser", () => {
  it("yields a commit when a new header line arrives", () => {
    const parser = new GitLogLineParser();

    // First commit lines
    expect(parser.processLine("abc123|alice@acme.com|Alice|2026-02-20T10:00:00Z|feat: add button")).toBeNull();
    expect(parser.processLine("10\t2\tsrc/button.ts")).toBeNull();

    // Second header finalizes first commit
    const commit = parser.processLine("def456|bob@acme.com|Bob|2026-02-21T10:00:00Z|fix: typo");
    expect(commit).not.toBeNull();
    expect(commit!.hash).toBe("abc123");
    expect(commit!.intent).toBe("feat");
    expect(commit!.files).toHaveLength(1);
    expect(commit!.files[0].insertions).toBe(10);

    // flush() returns the last commit
    const last = parser.flush();
    expect(last).not.toBeNull();
    expect(last!.hash).toBe("def456");
    expect(last!.intent).toBe("fix");
  });

  it("handles blank lines without yielding", () => {
    const parser = new GitLogLineParser();
    expect(parser.processLine("")).toBeNull();
    expect(parser.processLine("   ")).toBeNull();
  });

  it("produces identical results to parseGitLogOutput", () => {
    const output = [
      "aaa111|alice@acme.com|Alice|2026-02-20T10:00:00Z|feat: add feature",
      ":100644 100644 abcdef 123456 A\tsrc/new.ts",
      "10\t0\tsrc/new.ts",
      "",
      "bbb222|bob@acme.com|Bob|2026-02-21T10:00:00Z|fix: bug",
      ":100644 100644 abcdef 123456 M\tsrc/old.ts",
      "3\t1\tsrc/old.ts",
    ].join("\n");

    // Batch parse
    const batchCommits = parseGitLogOutput(output);

    // Streaming parse
    const parser = new GitLogLineParser();
    const streamCommits: Array<ReturnType<typeof parser.flush>> = [];
    for (const line of output.split("\n")) {
      const c = parser.processLine(line);
      if (c) streamCommits.push(c);
    }
    const last = parser.flush();
    if (last) streamCommits.push(last);

    expect(streamCommits).toHaveLength(batchCommits.length);
    for (let i = 0; i < batchCommits.length; i++) {
      expect(streamCommits[i]!.hash).toBe(batchCommits[i].hash);
      expect(streamCommits[i]!.intent).toBe(batchCommits[i].intent);
      expect(streamCommits[i]!.files.length).toBe(batchCommits[i].files.length);
      for (let j = 0; j < batchCommits[i].files.length; j++) {
        expect(streamCommits[i]!.files[j]).toEqual(batchCommits[i].files[j]);
      }
    }
  });

  it("returns null from flush when no commits were processed", () => {
    const parser = new GitLogLineParser();
    expect(parser.flush()).toBeNull();
  });
});

// ── calculateFastChurnRate ──────────────────────────────────────────────────

describe("calculateFastChurnRate", () => {
  beforeEach(() => {
    mockRaw.mockReset();
  });

  // Helper: build a git log --format=%H --numstat output for the author step
  function authorLog(commits: Array<{ hash: string; files: Array<[number, number, string]> }>): string {
    return commits
      .map((c) => [c.hash, ...c.files.map(([ins, del, p]) => `${ins}\t${del}\t${p}`)].join("\n"))
      .join("\n\n");
  }

  // Helper: build a git log --format=%H|%s --name-only output for the window step
  function windowLog(commits: Array<{ hash: string; subject: string; files: string[] }>): string {
    return commits
      .map((c) => [`${c.hash}|${c.subject}`, ...c.files].join("\n"))
      .join("\n\n");
  }

  it("returns 0 when author has no commits", async () => {
    mockRaw.mockResolvedValueOnce(""); // author log empty
    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    expect(result).toBe(0);
  });

  it("counts churn when author touches files recently modified by others", async () => {
    const authorHash = "a".repeat(40);
    const otherHash = "b".repeat(40);

    // Author touched app.ts (10+5=15 lines) and readme.md (2+1=3 lines)
    mockRaw.mockResolvedValueOnce(
      authorLog([{ hash: authorHash, files: [[10, 5, "src/app.ts"], [2, 1, "readme.md"]] }]),
    );

    // Window: someone else touched app.ts with a feat commit
    mockRaw.mockResolvedValueOnce(
      windowLog([{ hash: otherHash, subject: "feat: add feature", files: ["src/app.ts"] }]),
    );

    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    // 15 churn lines out of 18 total = 83%
    expect(result).toBe(83);
  });

  it("excludes chore commits from instability window", async () => {
    const authorHash = "a".repeat(40);
    const choreHash = "c".repeat(40);

    // Author touched app.ts
    mockRaw.mockResolvedValueOnce(
      authorLog([{ hash: authorHash, files: [[10, 5, "src/app.ts"]] }]),
    );

    // Window: only a chore commit touched app.ts — should be ignored
    mockRaw.mockResolvedValueOnce(
      windowLog([{ hash: choreHash, subject: "chore: fix linting", files: ["src/app.ts"] }]),
    );

    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    // chore is filtered out → app.ts not in recentlyModified → 0% churn
    expect(result).toBe(0);
  });

  it("excludes docs commits from instability window", async () => {
    const authorHash = "a".repeat(40);
    const docsHash = "d".repeat(40);

    mockRaw.mockResolvedValueOnce(
      authorLog([{ hash: authorHash, files: [[8, 2, "src/utils.ts"]] }]),
    );

    // Window: only a docs commit touched utils.ts
    mockRaw.mockResolvedValueOnce(
      windowLog([{ hash: docsHash, subject: "docs: update jsdoc", files: ["src/utils.ts"] }]),
    );

    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    expect(result).toBe(0);
  });

  it("includes fix and feat commits in instability window", async () => {
    const authorHash = "a".repeat(40);
    const fixHash = "f".repeat(40);

    mockRaw.mockResolvedValueOnce(
      authorLog([{ hash: authorHash, files: [[10, 5, "src/api.ts"]] }]),
    );

    mockRaw.mockResolvedValueOnce(
      windowLog([{ hash: fixHash, subject: "fix: null check", files: ["src/api.ts"] }]),
    );

    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    // fix is substantive → api.ts is in recentlyModified → 100% churn
    expect(result).toBe(100);
  });

  it("mixed: counts only files touched by substantive commits", async () => {
    const authorHash = "a".repeat(40);
    const choreHash = "c".repeat(40);
    const featHash = "e".repeat(40);

    // Author touched both files equally (10 lines each)
    mockRaw.mockResolvedValueOnce(
      authorLog([{ hash: authorHash, files: [[5, 5, "src/a.ts"], [5, 5, "src/b.ts"]] }]),
    );

    // Window: chore touched a.ts (ignored), feat touched b.ts (counted)
    mockRaw.mockResolvedValueOnce(
      windowLog([
        { hash: choreHash, subject: "chore: format", files: ["src/a.ts"] },
        { hash: featHash, subject: "feat: new thing", files: ["src/b.ts"] },
      ]),
    );

    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    // 10 churn lines (b.ts) out of 20 total = 50%
    expect(result).toBe(50);
  });

  it("excludes author's own commits from instability window", async () => {
    const authorHash = "a".repeat(40);

    mockRaw.mockResolvedValueOnce(
      authorLog([{ hash: authorHash, files: [[10, 5, "src/app.ts"]] }]),
    );

    // Window: the author's own commit touched app.ts
    mockRaw.mockResolvedValueOnce(
      windowLog([{ hash: authorHash, subject: "feat: my work", files: ["src/app.ts"] }]),
    );

    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    // Author's own commits excluded → 0% churn
    expect(result).toBe(0);
  });

  it("returns 0 when git log fails", async () => {
    mockRaw.mockRejectedValueOnce(new Error("git error"));
    const result = await calculateFastChurnRate("/repo", "dev@co.com", "2026-01-01", "2026-02-01");
    expect(result).toBe(0);
  });
});

// ── classifyGitError ────────────────────────────────────────────────────────

describe("classifyGitError", () => {
  it("classifies locked index as fatal", () => {
    const err = new Error("fatal: Unable to create '/repo/.git/index.lock': File exists.");
    const info = classifyGitError(err);
    expect(info.severity).toBe("fatal");
    expect(info.reason).toContain("locked");
  });

  it("classifies corrupt repository as fatal", () => {
    const info = classifyGitError(new Error("error: object file is empty or corrupt"));
    expect(info.severity).toBe("fatal");
    expect(info.reason).toContain("corrupt");
  });

  it("classifies not-a-git-repo as fatal", () => {
    const info = classifyGitError(new Error("fatal: not a git repository (or any parent up to mount point /)"));
    expect(info.severity).toBe("fatal");
    expect(info.reason).toContain("not a git repository");
  });

  it("classifies permission denied as fatal", () => {
    const info = classifyGitError(new Error("error: permission denied reading objects"));
    expect(info.severity).toBe("fatal");
    expect(info.reason).toContain("permission denied");
  });

  it("classifies bad revision as fatal", () => {
    const info = classifyGitError(new Error("fatal: bad revision 'nonexistent'"));
    expect(info.severity).toBe("fatal");
    expect(info.reason).toContain("bad revision");
  });

  it("classifies empty repo as expected", () => {
    const info = classifyGitError(new Error("fatal: your current branch 'main' does not have any commits yet"));
    expect(info.severity).toBe("expected");
    expect(info.reason).toContain("empty repository");
  });

  it("classifies unknown revision as expected", () => {
    const info = classifyGitError(new Error("fatal: unknown revision or path not in the working tree"));
    expect(info.severity).toBe("expected");
  });

  it("classifies no such path as expected", () => {
    const info = classifyGitError(new Error("fatal: no such path 'deleted-file.ts' in HEAD"));
    expect(info.severity).toBe("expected");
    expect(info.reason).toContain("file not found");
  });

  it("classifies ENOENT as transient", () => {
    const info = classifyGitError(new Error("ENOENT: no such file or directory, stat '/missing-repo'"));
    expect(info.severity).toBe("transient");
    expect(info.reason).toContain("path not found");
  });

  it("classifies EACCES as fatal", () => {
    const info = classifyGitError(new Error("EACCES: permission denied, open '/repo/.git/HEAD'"));
    expect(info.severity).toBe("fatal");
  });

  it("classifies unknown errors as transient", () => {
    const info = classifyGitError(new Error("something completely unexpected"));
    expect(info.severity).toBe("transient");
    expect(info.reason).toBe("unexpected git error");
  });

  it("handles non-Error values", () => {
    const info = classifyGitError("string error about corrupt data");
    expect(info.severity).toBe("fatal");
    expect(info.original).toBe("string error about corrupt data");
  });

  it("preserves original message", () => {
    const msg = "fatal: Unable to create '/repo/.git/index.lock': File exists.";
    const info = classifyGitError(new Error(msg));
    expect(info.original).toBe(msg);
  });
});
