import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS } from "../types/schema.js";
import type { Config, ScanState } from "../types/schema.js";
import type { ScanResult } from "../collector/git.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
}));

const mockScanRepo = vi.fn();

vi.mock("../collector/git.js", () => ({
  scanRepo: (...args: unknown[]) => mockScanRepo(...args),
}));

vi.mock("../collector/author-map.js", () => ({
  buildAuthorMap: vi.fn(() => new Map()),
  buildIdentifierRules: vi.fn(() => []),
}));

const { access } = await import("node:fs/promises");
const mockAccess = vi.mocked(access);

const { scanAllRepos } = await import("../collector/index.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSampleConfig(overrides?: Partial<Config>): Config {
  return {
    repos: [
      { path: "/repos/frontend", name: "frontend", group: "web" },
      { path: "/repos/backend", name: "backend", group: "api" },
    ],
    orgs: [
      {
        name: "Acme",
        type: "core",
        teams: [
          {
            name: "Platform",
            tag: "default",
            members: [{ name: "Alice", email: "alice@acme.com", aliases: [] }],
          },
        ],
      },
    ],
    groups: {},
    tags: {},
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

function makeScanState(repos?: ScanState["repos"]): ScanState {
  return { version: 1, repos: repos ?? {} };
}

function makeScanResult(overrides?: Partial<ScanResult>): ScanResult {
  return {
    newRecords: [],
    newHashes: [],
    commitCount: 0,
    skippedCount: 0,
    discoveredAuthors: [],
    ...overrides,
  };
}

function makeRecord(member: string, repo: string) {
  return {
    member,
    email: `${member.toLowerCase()}@acme.com`,
    org: "Acme",
    orgType: "core" as const,
    team: "Platform",
    tag: "default",
    week: "2026-W09",
    repo,
    group: "web",
    commits: 3,
    activeDays: 2,
    filetype: {
      app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
      test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 5 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("scanAllRepos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
  });

  it("scans all repos and aggregates results", async () => {
    mockScanRepo
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [makeRecord("Alice", "frontend")],
          newHashes: ["hash1", "hash2"],
          commitCount: 5,
        })
      )
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [makeRecord("Alice", "backend")],
          newHashes: ["hash3"],
          commitCount: 3,
        })
      );

    const result = await scanAllRepos(makeSampleConfig(), makeScanState());

    expect(result.allNewRecords).toHaveLength(2);
    expect(result.stats.totalCommits).toBe(8);
    expect(result.stats.totalRecords).toBe(2);
    expect(result.stats.reposScanned).toBe(2);
    expect(result.stats.reposSkipped).toBe(0);
    expect(result.stats.reposMissing).toBe(0);
  });

  it("skips fresh repos (not stale)", async () => {
    const recentDate = new Date().toISOString();
    const state = makeScanState({
      frontend: {
        lastHash: "abc",
        lastScanDate: recentDate,
        recentHashes: ["abc"],
        recordCount: 10,
      },
    });

    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newRecords: [makeRecord("Alice", "backend")],
        newHashes: ["xyz"],
        commitCount: 2,
      })
    );

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await scanAllRepos(makeSampleConfig(), state);

    expect(result.stats.reposSkipped).toBe(1);
    expect(result.stats.reposScanned).toBe(1);
    // scanRepo should only be called once (for backend)
    expect(mockScanRepo).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("frontend: fresh")
    );

    consoleSpy.mockRestore();
  });

  it("scans all repos when forceScan is true", async () => {
    const recentDate = new Date().toISOString();
    const state = makeScanState({
      frontend: {
        lastHash: "abc",
        lastScanDate: recentDate,
        recentHashes: ["abc"],
        recordCount: 10,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ commitCount: 1, newHashes: ["h1"] }))
      .mockResolvedValueOnce(makeScanResult({ commitCount: 2, newHashes: ["h2"] }));

    const result = await scanAllRepos(makeSampleConfig(), state, {
      forceScan: true,
    });

    expect(result.stats.reposScanned).toBe(2);
    expect(result.stats.reposSkipped).toBe(0);
    expect(mockScanRepo).toHaveBeenCalledTimes(2);
  });

  it("warns and skips repos with missing paths", async () => {
    mockAccess
      .mockRejectedValueOnce(new Error("ENOENT")) // frontend missing
      .mockResolvedValueOnce(undefined); // backend exists

    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({ commitCount: 1, newHashes: ["h1"] })
    );

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await scanAllRepos(makeSampleConfig(), makeScanState());

    expect(result.stats.reposMissing).toBe(1);
    expect(result.stats.reposScanned).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("frontend: path not found")
    );

    consoleSpy.mockRestore();
  });

  it("updates scan state with new hashes and dates", async () => {
    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newRecords: [makeRecord("Alice", "frontend")],
        newHashes: ["new1", "new2"],
        commitCount: 2,
      })
    ).mockResolvedValueOnce(
      makeScanResult({
        newRecords: [],
        newHashes: ["new3"],
        commitCount: 1,
      })
    );

    const result = await scanAllRepos(makeSampleConfig(), makeScanState());

    const frontendState = result.updatedScanState.repos["frontend"];
    expect(frontendState).toBeDefined();
    expect(frontendState.lastHash).toBe("new1");
    expect(frontendState.recentHashes).toContain("new1");
    expect(frontendState.recentHashes).toContain("new2");
    expect(frontendState.recordCount).toBe(1);

    const backendState = result.updatedScanState.repos["backend"];
    expect(backendState).toBeDefined();
    expect(backendState.lastHash).toBe("new3");
    expect(backendState.recordCount).toBe(0);
  });

  it("calculates since date as lastScanDate - 1 day", async () => {
    const state = makeScanState({
      frontend: {
        lastHash: "old",
        lastScanDate: "2026-02-20T10:00:00.000Z",
        recentHashes: ["old"],
        recordCount: 5,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h1"] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h2"] }));

    await scanAllRepos(makeSampleConfig(), state);

    // First call (frontend) should have since = "2026-02-19"
    const firstCallOptions = mockScanRepo.mock.calls[0][1];
    expect(firstCallOptions.since).toBe("2026-02-19");

    // Second call (backend) should have no since (first scan)
    const secondCallOptions = mockScanRepo.mock.calls[1][1];
    expect(secondCallOptions.since).toBeUndefined();
  });

  it("handles empty repos config gracefully", async () => {
    const config = makeSampleConfig({ repos: [] });
    const result = await scanAllRepos(config, makeScanState());

    expect(result.allNewRecords).toEqual([]);
    expect(result.stats.totalCommits).toBe(0);
    expect(result.stats.reposScanned).toBe(0);
  });

  it("preserves existing scan state for unscanned repos", async () => {
    const existingState = makeScanState({
      "other-repo": {
        lastHash: "preserved",
        lastScanDate: "2026-01-01T00:00:00Z",
        recentHashes: ["preserved"],
        recordCount: 50,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h1"] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h2"] }));

    const result = await scanAllRepos(makeSampleConfig(), existingState);

    // The unscanned "other-repo" should still be in the state
    expect(result.updatedScanState.repos["other-repo"]).toEqual(
      existingState.repos["other-repo"]
    );
  });

  it("uses custom staleness minutes from options", async () => {
    // Set lastScanDate to 30 minutes ago
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const state = makeScanState({
      frontend: {
        lastHash: "abc",
        lastScanDate: thirtyMinAgo,
        recentHashes: ["abc"],
        recordCount: 10,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h1"] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h2"] }));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // With stalenessMinutes=15, the 30-min-old scan should be stale
    const result = await scanAllRepos(makeSampleConfig(), state, {
      stalenessMinutes: 15,
    });

    expect(result.stats.reposScanned).toBe(2);
    expect(result.stats.reposSkipped).toBe(0);

    consoleSpy.mockRestore();
  });

  it("calls onRepoScanned after each repo and does not accumulate records", async () => {
    const frontendRecords = [makeRecord("Alice", "frontend")];
    const backendRecords = [makeRecord("Bob", "backend")];

    mockScanRepo
      .mockResolvedValueOnce(
        makeScanResult({ newRecords: frontendRecords, newHashes: ["h1"], commitCount: 1 })
      )
      .mockResolvedValueOnce(
        makeScanResult({ newRecords: backendRecords, newHashes: ["h2"], commitCount: 2 })
      );

    const flushed: unknown[][] = [];
    const onRepoScanned = vi.fn(async (records: unknown[]) => {
      flushed.push(records);
    });

    const result = await scanAllRepos(makeSampleConfig(), makeScanState(), {
      onRepoScanned,
    });

    // Callback called once per repo
    expect(onRepoScanned).toHaveBeenCalledTimes(2);
    expect(flushed[0]).toBe(frontendRecords);
    expect(flushed[1]).toBe(backendRecords);

    // allNewRecords should be empty (records were flushed via callback)
    expect(result.allNewRecords).toHaveLength(0);

    // Stats should still be correct
    expect(result.stats.totalRecords).toBe(2);
    expect(result.stats.reposScanned).toBe(2);
  });

  it("calls onScanStateUpdated after each repo", async () => {
    mockScanRepo
      .mockResolvedValueOnce(
        makeScanResult({ newRecords: [makeRecord("Alice", "frontend")], newHashes: ["h1"], commitCount: 1 })
      )
      .mockResolvedValueOnce(
        makeScanResult({ newRecords: [makeRecord("Bob", "backend")], newHashes: ["h2"], commitCount: 2 })
      );

    const states: unknown[] = [];
    const onScanStateUpdated = vi.fn(async (state: unknown) => {
      states.push(structuredClone(state));
    });

    await scanAllRepos(makeSampleConfig(), makeScanState(), {
      onScanStateUpdated,
    });

    // Called once per scanned repo
    expect(onScanStateUpdated).toHaveBeenCalledTimes(2);

    // After first call, only frontend should be in state
    const firstState = states[0] as { repos: Record<string, unknown> };
    expect(firstState.repos).toHaveProperty("frontend");
    expect(firstState.repos).not.toHaveProperty("backend");

    // After second call, both should be present
    const secondState = states[1] as { repos: Record<string, unknown> };
    expect(secondState.repos).toHaveProperty("frontend");
    expect(secondState.repos).toHaveProperty("backend");
  });

  it("passes chunkMonths through to scanRepo", async () => {
    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h1"] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ["h2"] }));

    await scanAllRepos(makeSampleConfig(), makeScanState(), {
      chunkMonths: 6,
    });

    for (const call of mockScanRepo.mock.calls) {
      expect(call[1].chunkMonths).toBe(6);
    }
  });
});
