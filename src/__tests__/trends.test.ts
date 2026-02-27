import { describe, it, expect } from "vitest";
import { computeTrend, computeRunningAvg } from "../aggregator/trends.js";
import type { UserWeekRepoRecord } from "../types/schema.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<UserWeekRepoRecord> = {},
): UserWeekRepoRecord {
  return {
    member: "alice",
    email: "alice@example.com",
    org: "Acme",
    orgType: "core",
    team: "Platform",
    tag: "infrastructure",
    week: "2026-W08",
    repo: "web-app",
    group: "web",
    commits: 5,
    activeDays: 3,
    filetype: {
      app: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
      test: { files: 4, filesAdded: 0, filesDeleted: 0, insertions: 40, deletions: 10 },
      config: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
      storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 8, deletions: 2 },
    },
    ...overrides,
  };
}

// ── computeTrend tests ────────────────────────────────────────────────────────

describe("computeTrend", () => {
  it("returns empty array for no records", () => {
    const result = computeTrend([]);
    expect(result).toEqual([]);
  });

  it("groups records by week and sums metrics", () => {
    const records = [
      makeRecord({ week: "2026-W07", commits: 3 }),
      makeRecord({ week: "2026-W07", commits: 7 }),
      makeRecord({ week: "2026-W08", commits: 5 }),
    ];

    const result = computeTrend(records);

    expect(result).toHaveLength(2);
    expect(result[0].week).toBe("2026-W07");
    expect(result[0].commits).toBe(10);
    expect(result[1].week).toBe("2026-W08");
    expect(result[1].commits).toBe(5);
  });

  it("returns trend points sorted by week (oldest first)", () => {
    const records = [
      makeRecord({ week: "2026-W10" }),
      makeRecord({ week: "2026-W07" }),
      makeRecord({ week: "2026-W09" }),
    ];

    const result = computeTrend(records);

    expect(result[0].week).toBe("2026-W07");
    expect(result[1].week).toBe("2026-W09");
    expect(result[2].week).toBe("2026-W10");
  });

  it("computes insertions and deletions from filetype sums", () => {
    const records = [
      makeRecord({
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 40, deletions: 10 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
          storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 8, deletions: 2 },
        },
      }),
    ];

    const result = computeTrend(records);
    const point = result[0];

    expect(point.insertions).toBe(163); // 100+40+15+8
    expect(point.deletions).toBe(37);  // 20+10+5+2
    expect(point.netLines).toBe(126);  // 163-37
  });

  it("computes app, test, config, storybook as insertions+deletions per filetype", () => {
    const records = [
      makeRecord({
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 40, deletions: 10 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
          storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 8, deletions: 2 },
        },
      }),
    ];

    const result = computeTrend(records);
    const point = result[0];

    expect(point.app).toBe(120);       // 100+20
    expect(point.test).toBe(50);       // 40+10
    expect(point.config).toBe(20);     // 15+5
    expect(point.storybook).toBe(10);  // 8+2
  });

  it("computes testRatio as test / (app + test)", () => {
    const records = [
      makeRecord({
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 40, deletions: 10 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
          storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 8, deletions: 2 },
        },
      }),
    ];

    const result = computeTrend(records);
    const point = result[0];

    // test=50, app=120, test/(app+test) = 50/170
    expect(point.testRatio).toBeCloseTo(50 / 170, 5);
  });

  it("handles testRatio div-by-zero when app and test are both zero", () => {
    const records = [
      makeRecord({
        week: "2026-W08",
        filetype: {
          app: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = computeTrend(records);
    expect(result[0].testRatio).toBe(0);
  });

  it("includes weekLabel from format utility", () => {
    const records = [makeRecord({ week: "2026-W08" })];
    const result = computeTrend(records);

    // weekLabel("2026-W08") should return something like "Feb 16"
    expect(result[0].weekLabel).toMatch(/^[A-Z][a-z]{2} \d+$/);
  });

  it("applies filters when provided", () => {
    const records = [
      makeRecord({ week: "2026-W08", org: "Acme", commits: 10 }),
      makeRecord({ week: "2026-W08", org: "Globex", commits: 5 }),
    ];

    const result = computeTrend(records, { org: "Acme" });

    expect(result).toHaveLength(1);
    expect(result[0].commits).toBe(10);
  });

  it("applies team filter", () => {
    const records = [
      makeRecord({ week: "2026-W08", team: "Platform", commits: 10 }),
      makeRecord({ week: "2026-W08", team: "Frontend", commits: 5 }),
    ];

    const result = computeTrend(records, { team: "Platform" });

    expect(result).toHaveLength(1);
    expect(result[0].commits).toBe(10);
  });
});

// ── computeRunningAvg tests ───────────────────────────────────────────────────

describe("computeRunningAvg", () => {
  it("returns 0 for no records", () => {
    const result = computeRunningAvg([], "Platform", "2026-W08", 12);
    expect(result).toBe(0);
  });

  it("returns 0 when no records match the team", () => {
    const records = [makeRecord({ team: "Frontend" })];
    const result = computeRunningAvg(records, "Platform", "2026-W08", 12);
    expect(result).toBe(0);
  });

  it("computes avg lines per person per week for a single member in one week", () => {
    const records = [
      makeRecord({
        member: "alice",
        team: "Platform",
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 40, deletions: 10 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = computeRunningAvg(records, "Platform", "2026-W08", 12);

    // totalLines = 100+20+40+10 = 170
    // headcount = 1, weeksActive = 1
    // avg = 170 / 1 / 1 = 170
    expect(result).toBe(170);
  });

  it("computes avg across multiple members and weeks", () => {
    const records = [
      makeRecord({
        member: "alice",
        team: "Platform",
        week: "2026-W07",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
      makeRecord({
        member: "bob",
        team: "Platform",
        week: "2026-W08",
        filetype: {
          app: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 60, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = computeRunningAvg(records, "Platform", "2026-W08", 12);

    // totalLines = 100 + 60 = 160
    // headcount = 2, weeksActive = 2
    // avg = 160 / 2 / 2 = 40
    expect(result).toBe(40);
  });

  it("only includes records within the window", () => {
    const records = [
      // Within 4-week window of W08: W05, W06, W07, W08
      makeRecord({
        member: "alice",
        team: "Platform",
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
      // Outside window (W04 is outside 4-week window ending W08)
      makeRecord({
        member: "alice",
        team: "Platform",
        week: "2026-W04",
        filetype: {
          app: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 1000, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = computeRunningAvg(records, "Platform", "2026-W08", 4);

    // Only W08 record: totalLines=100, headcount=1, weeksActive=1
    expect(result).toBe(100);
  });

  it("defaults window to 12 weeks", () => {
    const records = [
      makeRecord({
        member: "alice",
        team: "Platform",
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 120, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    // Should work without specifying window (defaults to 12)
    const result = computeRunningAvg(records, "Platform", "2026-W08");
    expect(result).toBe(120);
  });
});
