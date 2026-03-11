import { describe, it, expect } from "vitest";
import { parseGitHubUrl, calculateCycleTime } from "../collector/github.js";

// ── parseGitHubUrl ──────────────────────────────────────────────────────────

describe("parseGitHubUrl", () => {
  it("parses HTTPS URL with .git suffix", () => {
    const result = parseGitHubUrl("https://github.com/acme/frontend.git");
    expect(result).toEqual({ owner: "acme", repo: "frontend" });
  });

  it("parses HTTPS URL without .git suffix", () => {
    const result = parseGitHubUrl("https://github.com/acme/frontend");
    expect(result).toEqual({ owner: "acme", repo: "frontend" });
  });

  it("parses SSH URL with .git suffix", () => {
    const result = parseGitHubUrl("git@github.com:acme/frontend.git");
    expect(result).toEqual({ owner: "acme", repo: "frontend" });
  });

  it("parses SSH URL without .git suffix", () => {
    const result = parseGitHubUrl("git@github.com:acme/frontend");
    expect(result).toEqual({ owner: "acme", repo: "frontend" });
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitHubUrl("https://gitlab.com/acme/frontend.git")).toBeNull();
    expect(parseGitHubUrl("https://bitbucket.org/acme/frontend.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitHubUrl("")).toBeNull();
  });

  it("handles repos with hyphens and dots", () => {
    const result = parseGitHubUrl("https://github.com/my-org/my-repo.js.git");
    expect(result).toEqual({ owner: "my-org", repo: "my-repo.js" });
  });
});

// ── calculateCycleTime ──────────────────────────────────────────────────────

describe("calculateCycleTime", () => {
  it("returns 0 for empty array", () => {
    expect(calculateCycleTime([])).toBe(0);
  });

  it("returns 0 when no PRs are merged", () => {
    const prs = [
      { createdAt: "2026-03-01T10:00:00Z", mergedAt: null },
      { createdAt: "2026-03-02T10:00:00Z", mergedAt: null },
    ];
    expect(calculateCycleTime(prs)).toBe(0);
  });

  it("calculates median for a single merged PR", () => {
    const prs = [
      {
        createdAt: "2026-03-01T10:00:00Z",
        mergedAt: "2026-03-01T22:00:00Z", // 12 hours
      },
    ];
    expect(calculateCycleTime(prs)).toBe(12);
  });

  it("calculates median for odd number of merged PRs", () => {
    const prs = [
      { createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-01T02:00:00Z" }, // 2h
      { createdAt: "2026-03-02T00:00:00Z", mergedAt: "2026-03-02T24:00:00Z" }, // 24h
      { createdAt: "2026-03-03T00:00:00Z", mergedAt: "2026-03-03T06:00:00Z" }, // 6h
    ];
    // Sorted: [2, 6, 24] → median = 6
    expect(calculateCycleTime(prs)).toBe(6);
  });

  it("calculates median for even number of merged PRs", () => {
    const prs = [
      { createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-01T04:00:00Z" }, // 4h
      { createdAt: "2026-03-02T00:00:00Z", mergedAt: "2026-03-02T08:00:00Z" }, // 8h
      { createdAt: "2026-03-03T00:00:00Z", mergedAt: "2026-03-03T12:00:00Z" }, // 12h
      { createdAt: "2026-03-04T00:00:00Z", mergedAt: "2026-03-04T48:00:00Z" }, // 48h
    ];
    // Sorted: [4, 8, 12, 48] → median = (8+12)/2 = 10
    expect(calculateCycleTime(prs)).toBe(10);
  });

  it("ignores unmerged PRs in the calculation", () => {
    const prs = [
      { createdAt: "2026-03-01T00:00:00Z", mergedAt: null }, // unmerged
      { createdAt: "2026-03-02T00:00:00Z", mergedAt: "2026-03-02T10:00:00Z" }, // 10h
      { createdAt: "2026-03-03T00:00:00Z", mergedAt: null }, // unmerged
    ];
    expect(calculateCycleTime(prs)).toBe(10);
  });

  it("handles sub-hour durations with rounding", () => {
    const prs = [
      {
        createdAt: "2026-03-01T10:00:00Z",
        mergedAt: "2026-03-01T10:30:00Z", // 0.5 hours
      },
    ];
    expect(calculateCycleTime(prs)).toBe(0.5);
  });

  it("clamps negative durations to 0", () => {
    // Edge case: mergedAt before createdAt (shouldn't happen but be safe)
    const prs = [
      {
        createdAt: "2026-03-01T10:00:00Z",
        mergedAt: "2026-03-01T08:00:00Z",
      },
    ];
    expect(calculateCycleTime(prs)).toBe(0);
  });
});
