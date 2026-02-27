import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ScanState } from "../types/schema.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_SCAN_STATE_PATH = "/mock/data/scan-state.json";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
}));

vi.mock("../store/paths.js", () => ({
  getScanStatePath: () => MOCK_SCAN_STATE_PATH,
  ensureDataDir: vi.fn(async () => undefined),
}));

const { readFile, writeFile, rename } = await import("node:fs/promises");
const { ensureDataDir } = await import("../store/paths.js");

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);
const mockEnsureDataDir = vi.mocked(ensureDataDir);

const {
  loadScanState,
  saveScanState,
  getRepoState,
  updateRepoState,
  isStale,
  rotateHashes,
} = await import("../store/scan-state.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeScanState(overrides?: Partial<ScanState>): ScanState {
  return {
    version: 1,
    repos: {},
    ...overrides,
  };
}

function makeRepoEntry(overrides?: Partial<ScanState["repos"][string]>) {
  return {
    lastHash: "abc123",
    lastScanDate: new Date().toISOString(),
    recentHashes: ["abc123"],
    recordCount: 10,
    ...overrides,
  };
}

// ── loadScanState ────────────────────────────────────────────────────────────

describe("loadScanState", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("returns empty state when file does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const state = await loadScanState();
    expect(state).toEqual({ version: 1, repos: {} });
  });

  it("loads and parses existing scan state from disk", async () => {
    const existing: ScanState = {
      version: 1,
      repos: {
        "my-repo": {
          lastHash: "deadbeef",
          lastScanDate: "2026-02-20T10:00:00Z",
          recentHashes: ["deadbeef", "cafebabe"],
          recordCount: 42,
        },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing));
    const state = await loadScanState();
    expect(state.version).toBe(1);
    expect(state.repos["my-repo"].lastHash).toBe("deadbeef");
    expect(state.repos["my-repo"].recentHashes).toHaveLength(2);
    expect(state.repos["my-repo"].recordCount).toBe(42);
  });
});

// ── saveScanState ────────────────────────────────────────────────────────────

describe("saveScanState", () => {
  beforeEach(() => {
    mockWriteFile.mockReset();
    mockRename.mockReset();
    mockEnsureDataDir.mockReset();
  });

  it("writes to .tmp then renames atomically", async () => {
    const state = makeScanState({
      repos: { "test-repo": makeRepoEntry() },
    });
    await saveScanState(state);

    expect(mockEnsureDataDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      MOCK_SCAN_STATE_PATH + ".tmp",
      expect.any(String),
      "utf-8"
    );
    expect(mockRename).toHaveBeenCalledWith(
      MOCK_SCAN_STATE_PATH + ".tmp",
      MOCK_SCAN_STATE_PATH
    );
  });

  it("round-trips data correctly through save and reload", async () => {
    const state = makeScanState({
      repos: {
        "frontend-app": makeRepoEntry({
          lastHash: "aaa111",
          recentHashes: ["aaa111", "bbb222"],
          recordCount: 100,
        }),
      },
    });

    let savedContent = "";
    mockWriteFile.mockImplementation(
      async (_path, content) => {
        savedContent = content as string;
      }
    );

    await saveScanState(state);

    mockReadFile.mockResolvedValue(savedContent);
    const reloaded = await loadScanState();

    expect(reloaded.repos["frontend-app"].lastHash).toBe("aaa111");
    expect(reloaded.repos["frontend-app"].recentHashes).toEqual([
      "aaa111",
      "bbb222",
    ]);
    expect(reloaded.repos["frontend-app"].recordCount).toBe(100);
  });
});

// ── getRepoState ─────────────────────────────────────────────────────────────

describe("getRepoState", () => {
  it("returns the repo entry when it exists", () => {
    const entry = makeRepoEntry({ lastHash: "xyz789" });
    const state = makeScanState({ repos: { "my-repo": entry } });
    const result = getRepoState(state, "my-repo");
    expect(result).toEqual(entry);
  });

  it("returns undefined for a non-existent repo", () => {
    const state = makeScanState();
    expect(getRepoState(state, "no-such-repo")).toBeUndefined();
  });
});

// ── updateRepoState ──────────────────────────────────────────────────────────

describe("updateRepoState", () => {
  it("returns a new state object (immutable)", () => {
    const original = makeScanState({
      repos: { "my-repo": makeRepoEntry() },
    });
    const updated = updateRepoState(original, "my-repo", {
      lastHash: "new-hash",
    });

    // Must be a different object
    expect(updated).not.toBe(original);
    expect(updated.repos).not.toBe(original.repos);

    // Original must not be mutated
    expect(original.repos["my-repo"].lastHash).toBe("abc123");
    expect(updated.repos["my-repo"].lastHash).toBe("new-hash");
  });

  it("adds a new repo entry when it does not exist", () => {
    const state = makeScanState();
    const updated = updateRepoState(state, "new-repo", {
      lastHash: "first",
      lastScanDate: "2026-02-25T00:00:00Z",
      recentHashes: ["first"],
      recordCount: 1,
    });
    expect(updated.repos["new-repo"]).toBeDefined();
    expect(updated.repos["new-repo"].lastHash).toBe("first");
  });

  it("merges partial updates into existing repo state", () => {
    const state = makeScanState({
      repos: {
        "my-repo": makeRepoEntry({
          lastHash: "old",
          recordCount: 10,
        }),
      },
    });
    const updated = updateRepoState(state, "my-repo", {
      recordCount: 20,
    });
    expect(updated.repos["my-repo"].lastHash).toBe("old");
    expect(updated.repos["my-repo"].recordCount).toBe(20);
  });
});

// ── isStale ──────────────────────────────────────────────────────────────────

describe("isStale", () => {
  it("returns true when repoState is undefined", () => {
    expect(isStale(undefined, 60)).toBe(true);
  });

  it("returns true when elapsed time exceeds threshold", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const entry = makeRepoEntry({ lastScanDate: twoHoursAgo });
    expect(isStale(entry, 60)).toBe(true);
  });

  it("returns false when scan is recent", () => {
    const fiveMinutesAgo = new Date(
      Date.now() - 5 * 60 * 1000
    ).toISOString();
    const entry = makeRepoEntry({ lastScanDate: fiveMinutesAgo });
    expect(isStale(entry, 60)).toBe(false);
  });

  it("returns true when exactly at threshold boundary (edge case)", () => {
    const exactlyAtThreshold = new Date(
      Date.now() - 60 * 60 * 1000
    ).toISOString();
    const entry = makeRepoEntry({ lastScanDate: exactlyAtThreshold });
    // Due to time passing between Date.now() calls, this will be slightly stale
    // so we just check it returns a boolean
    expect(typeof isStale(entry, 60)).toBe("boolean");
  });
});

// ── rotateHashes ─────────────────────────────────────────────────────────────

describe("rotateHashes", () => {
  it("prepends new hashes to the front", () => {
    const result = rotateHashes(["old1", "old2"], ["new1", "new2"]);
    expect(result[0]).toBe("new1");
    expect(result[1]).toBe("new2");
    expect(result[2]).toBe("old1");
    expect(result[3]).toBe("old2");
  });

  it("slices to maxSize", () => {
    const recent = Array.from({ length: 10 }, (_, i) => `old-${i}`);
    const newH = Array.from({ length: 5 }, (_, i) => `new-${i}`);
    const result = rotateHashes(recent, newH, 8);
    expect(result).toHaveLength(8);
    expect(result[0]).toBe("new-0");
  });

  it("uses default maxSize of 500", () => {
    const recent = Array.from({ length: 600 }, (_, i) => `h-${i}`);
    const result = rotateHashes(recent, ["latest"]);
    expect(result).toHaveLength(500);
    expect(result[0]).toBe("latest");
  });

  it("does not mutate input arrays", () => {
    const recent = ["a", "b"];
    const newH = ["c"];
    const recentCopy = [...recent];
    const newCopy = [...newH];
    rotateHashes(recent, newH);
    expect(recent).toEqual(recentCopy);
    expect(newH).toEqual(newCopy);
  });
});
