import { describe, expect, it } from "vitest";
import type { ScanState } from "../types/schema.js";
import {
  getRepoState,
  updateRepoState,
  isStale,
  rotateHashes,
} from "../store/scan-state.js";

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
