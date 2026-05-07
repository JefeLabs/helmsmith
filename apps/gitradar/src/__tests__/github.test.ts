import { describe, it, expect, vi } from "vitest";

// Inline sanitize for testing (mirrors the private function in github.ts)
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

import { parseGitHubUrl, calculateCycleTime, GitHubRateLimiter, fetchGitHubMetrics, fetchGitHubMetricsBatch, createCacheStats, classifyBranch, countBranchTypes } from "../collector/github.js";

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

// ── GitHubRateLimiter ───────────────────────────────────────────────────────

describe("GitHubRateLimiter", () => {
  it("allows requests when remaining is high", async () => {
    const limiter = new GitHubRateLimiter();
    // Should resolve immediately (remaining starts at Infinity)
    await limiter.acquire();
    await limiter.acquire();
  });

  it("updates state from headers", () => {
    const limiter = new GitHubRateLimiter();
    limiter.update({
      "x-ratelimit-remaining": "100",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    });
    // After update, should still allow requests (100 remaining > 5 threshold)
  });

  it("waits when remaining is low and reset is in the future, then resets budget", async () => {
    const limiter = new GitHubRateLimiter();
    // Set remaining very low, reset 1 second from now
    limiter.update({
      "x-ratelimit-remaining": "3",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1),
    });

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    // Should have waited ~1 second + 500ms buffer
    expect(elapsed).toBeGreaterThan(500);

    // After waiting, remaining should have been reset to ~100 (minus 1 for the acquire)
    // so a subsequent acquire should be immediate
    const start2 = Date.now();
    await limiter.acquire();
    expect(Date.now() - start2).toBeLessThan(50);
  });

  it("updateFromGraphQL updates remaining and resetAt", async () => {
    const limiter = new GitHubRateLimiter();
    const resetAt = new Date(Date.now() + 3600000).toISOString();
    limiter.updateFromGraphQL({ remaining: 50, resetAt });
    // Should allow immediate acquire since remaining (50) > 5
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("does not wait when reset is in the past", async () => {
    const limiter = new GitHubRateLimiter();
    // Set remaining low, but reset is in the past
    limiter.update({
      "x-ratelimit-remaining": "3",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 60),
    });

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

// ── fetchGitHubMetrics (GraphQL) ────────────────────────────────────────────

describe("fetchGitHubMetrics", () => {
  it("returns metrics from a successful GraphQL response", async () => {
    const mockOctokit = {
      graphql: vi.fn().mockResolvedValueOnce({
        prs: {
          issueCount: 3,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { number: 1, createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-01T12:00:00Z", state: "MERGED", headRefName: "feature/auth" },
            { number: 2, createdAt: "2026-03-02T00:00:00Z", mergedAt: null, state: "OPEN", headRefName: "fix/login-bug" },
            { number: 3, createdAt: "2026-03-03T00:00:00Z", mergedAt: "2026-03-03T06:00:00Z", state: "MERGED", headRefName: "hotfix/critical" },
          ],
        },
        reviews: { issueCount: 5 },
      }),
    };

    const result = await fetchGitHubMetrics({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      githubHandle: "jdoe",
      since: "2026-03-01",
      until: "2026-03-07",
      skipCache: true,
    });

    expect(result.prs_opened).toBe(3);
    expect(result.prs_merged).toBe(2);
    expect(result.reviews_given).toBe(5);
    expect(result.avg_cycle_hrs).toBeGreaterThan(0);
  });

  it("paginates when hasNextPage is true", async () => {
    const mockOctokit = {
      graphql: vi.fn()
        .mockResolvedValueOnce({
          prs: {
            issueCount: 2,
            pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            nodes: [
              { number: 1, createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-01T12:00:00Z", state: "MERGED", headRefName: "feature/auth" },
            ],
          },
          reviews: { issueCount: 0 },
        })
        .mockResolvedValueOnce({
          prs: {
            issueCount: 2,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { number: 2, createdAt: "2026-03-02T00:00:00Z", mergedAt: null, state: "OPEN", headRefName: "fix/login-bug" },
            ],
          },
        }),
    };

    const result = await fetchGitHubMetrics({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      githubHandle: "jdoe",
      since: "2026-03-01",
      until: "2026-03-07",
      skipCache: true,
    });

    expect(result.prs_opened).toBe(2);
    expect(result.prs_merged).toBe(1);
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(2);
  });

  it("returns zeros when GraphQL fails", async () => {
    const mockOctokit = {
      graphql: vi.fn().mockRejectedValueOnce(new Error("GraphQL fail")),
    };

    const result = await fetchGitHubMetrics({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      githubHandle: "jdoe",
      since: "2026-03-01",
      until: "2026-03-07",
      skipCache: true,
    });

    expect(result).toEqual({
      prs_opened: 0, prs_merged: 0, avg_cycle_hrs: 0, reviews_given: 0,
      pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0,
    });
  });

  it("passes rateLimiter to acquire before requests", async () => {
    const rateLimiter = new GitHubRateLimiter();
    const acquireSpy = vi.spyOn(rateLimiter, "acquire");

    const mockOctokit = {
      graphql: vi.fn().mockResolvedValueOnce({
        prs: {
          issueCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
        reviews: { issueCount: 0 },
      }),
    };

    await fetchGitHubMetrics({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      githubHandle: "jdoe",
      since: "2026-03-01",
      until: "2026-03-07",
      rateLimiter,
      skipCache: true,
    });

    expect(acquireSpy).toHaveBeenCalledTimes(1);
  });
});

// ── fetchGitHubMetricsBatch ─────────────────────────────────────────────────

describe("fetchGitHubMetricsBatch", () => {
  it("returns metrics for multiple authors in a single GraphQL call", async () => {
    const mockOctokit = {
      graphql: vi.fn().mockResolvedValueOnce({
        a0_prs: {
          issueCount: 2,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { number: 1, createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-01T12:00:00Z", state: "MERGED", headRefName: "feature/auth" },
            { number: 2, createdAt: "2026-03-02T00:00:00Z", mergedAt: null, state: "OPEN", headRefName: "fix/login-bug" },
          ],
        },
        a0_reviews: { issueCount: 3 },
        a1_prs: {
          issueCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { number: 3, createdAt: "2026-03-03T00:00:00Z", mergedAt: "2026-03-03T06:00:00Z", state: "MERGED", headRefName: "hotfix/critical" },
          ],
        },
        a1_reviews: { issueCount: 7 },
        rateLimit: { remaining: 4990, resetAt: new Date(Date.now() + 3600000).toISOString() },
      }),
    };

    const results = await fetchGitHubMetricsBatch({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      entries: [
        { githubHandle: "alice", since: "2026-03-01", until: "2026-03-07" },
        { githubHandle: "bob", since: "2026-03-01", until: "2026-03-07" },
      ],
      skipCache: true,
    });

    expect(results).toHaveLength(2);

    const alice = results.find((r) => r.handle === "alice")!;
    expect(alice.metrics.prs_opened).toBe(2);
    expect(alice.metrics.prs_merged).toBe(1);
    expect(alice.metrics.reviews_given).toBe(3);
    expect(alice.metrics.avg_cycle_hrs).toBe(12);

    const bob = results.find((r) => r.handle === "bob")!;
    expect(bob.metrics.prs_opened).toBe(1);
    expect(bob.metrics.prs_merged).toBe(1);
    expect(bob.metrics.reviews_given).toBe(7);
    expect(bob.metrics.avg_cycle_hrs).toBe(6);

    // Only one GraphQL call for both authors
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it("falls back to individual queries when batch fails", async () => {
    const mockOctokit = {
      graphql: vi.fn()
        // First call: batch fails
        .mockRejectedValueOnce(new Error("batch failed"))
        // Individual fallback for alice
        .mockResolvedValueOnce({
          prs: {
            issueCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { number: 1, createdAt: "2026-03-01T00:00:00Z", mergedAt: "2026-03-01T12:00:00Z", state: "MERGED", headRefName: "feature/auth" },
            ],
          },
          reviews: { issueCount: 2 },
        })
        // Individual fallback for bob
        .mockResolvedValueOnce({
          prs: {
            issueCount: 0,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
          reviews: { issueCount: 0 },
        }),
    };

    const results = await fetchGitHubMetricsBatch({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      entries: [
        { githubHandle: "alice", since: "2026-03-01", until: "2026-03-07" },
        { githubHandle: "bob", since: "2026-03-01", until: "2026-03-07" },
      ],
      skipCache: true,
    });

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.handle === "alice")!.metrics.prs_opened).toBe(1);
    expect(results.find((r) => r.handle === "bob")!.metrics.prs_opened).toBe(0);
    // 1 batch attempt + 2 individual fallbacks
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(3);
  });

  it("returns empty results for empty entries array", async () => {
    const mockOctokit = { graphql: vi.fn() };

    const results = await fetchGitHubMetricsBatch({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      entries: [],
      skipCache: true,
    });

    expect(results).toHaveLength(0);
    expect(mockOctokit.graphql).not.toHaveBeenCalled();
  });

  it("tracks cache stats across batch calls", async () => {
    const mockOctokit = {
      graphql: vi.fn().mockResolvedValueOnce({
        a0_prs: {
          issueCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
        a0_reviews: { issueCount: 0 },
        rateLimit: { remaining: 4999, resetAt: new Date(Date.now() + 3600000).toISOString() },
      }),
    };

    const cacheStats = createCacheStats();
    await fetchGitHubMetricsBatch({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      entries: [
        { githubHandle: "alice", since: "2026-03-01", until: "2026-03-07" },
      ],
      skipCache: true,
      cacheStats,
    });

    expect(cacheStats.misses).toBe(1);
    expect(cacheStats.hits).toBe(0);
  });

  it("paginates individually when an author has >100 PRs", async () => {
    const mockOctokit = {
      graphql: vi.fn()
        // Batch response: alice has hasNextPage=true
        .mockResolvedValueOnce({
          a0_prs: {
            issueCount: 150,
            pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            nodes: Array.from({ length: 100 }, (_, i) => ({
              number: i + 1,
              createdAt: "2026-03-01T00:00:00Z",
              mergedAt: null,
              state: "OPEN",
              headRefName: "feature/bulk",
            })),
          },
          a0_reviews: { issueCount: 0 },
          rateLimit: { remaining: 4990, resetAt: new Date(Date.now() + 3600000).toISOString() },
        })
        // Individual fetchGitHubMetrics fallback for alice (first page)
        .mockResolvedValueOnce({
          prs: {
            issueCount: 150,
            pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            nodes: Array.from({ length: 100 }, (_, i) => ({
              number: i + 1,
              createdAt: "2026-03-01T00:00:00Z",
              mergedAt: null,
              state: "OPEN",
              headRefName: "feature/bulk",
            })),
          },
          reviews: { issueCount: 0 },
        })
        // Pagination for alice (second page)
        .mockResolvedValueOnce({
          prs: {
            issueCount: 150,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: Array.from({ length: 50 }, (_, i) => ({
              number: i + 101,
              createdAt: "2026-03-01T00:00:00Z",
              mergedAt: null,
              state: "OPEN",
              headRefName: "feature/bulk",
            })),
          },
          rateLimit: { remaining: 4989, resetAt: new Date(Date.now() + 3600000).toISOString() },
        }),
    };

    const results = await fetchGitHubMetricsBatch({
      octokit: mockOctokit as any,
      owner: "acme",
      repo: "frontend",
      entries: [
        { githubHandle: "alice", since: "2026-03-01", until: "2026-03-07" },
      ],
      skipCache: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].metrics.prs_opened).toBe(150);
  });
});

// ── Cache key sanitization ──────────────────────────────────────────────────

describe("cache key sanitization", () => {
  it("strips path traversal characters", () => {
    expect(sanitize("../../../etc")).toBe("_________etc");
  });

  it("preserves safe characters", () => {
    expect(sanitize("my-org_repo-123")).toBe("my-org_repo-123");
  });

  it("replaces slashes and dots", () => {
    expect(sanitize("owner/repo.name")).toBe("owner_repo_name");
  });
});

// ── CacheStats ──────────────────────────────────────────────────────────────

describe("createCacheStats", () => {
  it("initializes with zero hits and misses", () => {
    const stats = createCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it("is mutable for accumulation", () => {
    const stats = createCacheStats();
    stats.hits += 5;
    stats.misses += 3;
    expect(stats.hits).toBe(5);
    expect(stats.misses).toBe(3);
  });
});

// ── classifyBranch ──────────────────────────────────────────────────────────

describe("classifyBranch", () => {
  it("classifies feature/ branches", () => {
    expect(classifyBranch("feature/add-auth")).toBe("feature");
    expect(classifyBranch("feature/PROJ-123-new-ui")).toBe("feature");
  });

  it("classifies fix/ branches", () => {
    expect(classifyBranch("fix/login-bug")).toBe("fix");
  });

  it("classifies bugfix/ branches", () => {
    expect(classifyBranch("bugfix/null-pointer")).toBe("bugfix");
  });

  it("classifies chore/ branches", () => {
    expect(classifyBranch("chore/update-deps")).toBe("chore");
  });

  it("classifies hotfix/ branches", () => {
    expect(classifyBranch("hotfix/critical-security")).toBe("hotfix");
  });

  it("classifies unknown prefixes as other", () => {
    expect(classifyBranch("release/v2.0")).toBe("other");
    expect(classifyBranch("main")).toBe("other");
    expect(classifyBranch("experiment-new-approach")).toBe("other");
  });

  it("is case-insensitive on prefix", () => {
    expect(classifyBranch("Feature/add-auth")).toBe("feature");
    expect(classifyBranch("HOTFIX/critical")).toBe("hotfix");
  });
});

// ── countBranchTypes ────────────────────────────────────────────────────────

describe("countBranchTypes", () => {
  it("counts branch types from PR list", () => {
    const prs = [
      { headRefName: "feature/auth" },
      { headRefName: "feature/dashboard" },
      { headRefName: "fix/login-bug" },
      { headRefName: "hotfix/urgent" },
      { headRefName: "chore/deps" },
      { headRefName: "release/v1.0" },
    ];

    expect(countBranchTypes(prs)).toEqual({
      pr_feature: 2,
      pr_fix: 1,
      pr_bugfix: 0,
      pr_chore: 1,
      pr_hotfix: 1,
      pr_other: 1,
    });
  });

  it("returns all zeros for empty list", () => {
    expect(countBranchTypes([])).toEqual({
      pr_feature: 0,
      pr_fix: 0,
      pr_bugfix: 0,
      pr_chore: 0,
      pr_hotfix: 0,
      pr_other: 0,
    });
  });
});
