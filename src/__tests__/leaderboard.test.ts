import { describe, it, expect } from "vitest";
import { computeLeaderboard } from "../aggregator/leaderboard.js";
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeLeaderboard", () => {
  const weeks = ["2026-W05", "2026-W06", "2026-W07", "2026-W08"];

  it("returns 4 columns with correct titles and metrics", () => {
    const records = [makeRecord()];
    const result = computeLeaderboard(records, weeks);

    expect(result).toHaveLength(4);
    expect(result[0].title).toBe("Overall");
    expect(result[0].metric).toBe("all");
    expect(result[1].title).toBe("App");
    expect(result[1].metric).toBe("app");
    expect(result[2].title).toBe("Test");
    expect(result[2].metric).toBe("test");
    expect(result[3].title).toBe("Config");
    expect(result[3].metric).toBe("config");
  });

  it("returns empty entries when no records match weeks", () => {
    const records = [makeRecord({ week: "2025-W01" })];
    const result = computeLeaderboard(records, weeks);

    for (const col of result) {
      expect(col.entries).toHaveLength(0);
    }
  });

  it("ranks members by overall total (insertions + deletions)", () => {
    const records = [
      makeRecord({
        member: "alice",
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 200, deletions: 50 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 40, deletions: 10 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 5 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
      makeRecord({
        member: "bob",
        week: "2026-W08",
        filetype: {
          app: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 500, deletions: 100 },
          test: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
          config: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 10 },
          storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 5, deletions: 2 },
        },
      }),
    ];

    const result = computeLeaderboard(records, weeks);
    const overall = result[0];

    expect(overall.entries[0].member).toBe("bob");
    expect(overall.entries[0].rank).toBe(1);
    expect(overall.entries[1].member).toBe("alice");
    expect(overall.entries[1].rank).toBe(2);

    // bob overall: 500+100+100+20+30+10+5+2 = 767
    expect(overall.entries[0].value).toBe(767);
    // alice overall: 200+50+40+10+10+5+0+0 = 315
    expect(overall.entries[1].value).toBe(315);
  });

  it("ranks by app metric in the App column", () => {
    const records = [
      makeRecord({
        member: "alice",
        week: "2026-W07",
        filetype: {
          app: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 5 },
          test: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 500, deletions: 100 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
      makeRecord({
        member: "bob",
        week: "2026-W07",
        filetype: {
          app: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 300, deletions: 50 },
          test: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 5, deletions: 2 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = computeLeaderboard(records, weeks);
    const appCol = result[1];

    // bob app: 300+50=350, alice app: 10+5=15
    expect(appCol.entries[0].member).toBe("bob");
    expect(appCol.entries[0].value).toBe(350);
    expect(appCol.entries[1].member).toBe("alice");
    expect(appCol.entries[1].value).toBe(15);
  });

  it("respects topN cutoff", () => {
    const records = [
      makeRecord({ member: "alice", week: "2026-W08", commits: 10 }),
      makeRecord({ member: "bob", week: "2026-W08", commits: 8 }),
      makeRecord({ member: "carol", week: "2026-W08", commits: 6 }),
      makeRecord({ member: "dave", week: "2026-W08", commits: 4 }),
      makeRecord({ member: "eve", week: "2026-W08", commits: 2 }),
    ];

    const result = computeLeaderboard(records, weeks, 3);

    for (const col of result) {
      expect(col.entries.length).toBeLessThanOrEqual(3);
    }
  });

  it("assigns correct rank numbers", () => {
    const records = [
      makeRecord({ member: "alice", week: "2026-W08" }),
      makeRecord({ member: "bob", week: "2026-W08" }),
      makeRecord({ member: "carol", week: "2026-W08" }),
    ];

    const result = computeLeaderboard(records, weeks);
    const overall = result[0];

    expect(overall.entries[0].rank).toBe(1);
    expect(overall.entries[1].rank).toBe(2);
    expect(overall.entries[2].rank).toBe(3);
  });

  it("includes filetype breakdown in each entry", () => {
    const records = [
      makeRecord({
        member: "alice",
        week: "2026-W08",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
          test: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 60, deletions: 15 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 5 },
          storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 8, deletions: 2 },
        },
      }),
    ];

    const result = computeLeaderboard(records, weeks);
    const entry = result[0].entries[0];

    expect(entry.filetype.app).toBe(120); // 100+20
    expect(entry.filetype.test).toBe(75); // 60+15
    expect(entry.filetype.config).toBe(15); // 10+5
    expect(entry.filetype.storybook).toBe(10); // 8+2
  });

  it("includes member metadata (team, org, orgType)", () => {
    const records = [
      makeRecord({
        member: "alice",
        team: "Platform",
        org: "Acme",
        orgType: "core",
        week: "2026-W08",
      }),
    ];

    const result = computeLeaderboard(records, weeks);
    const entry = result[0].entries[0];

    expect(entry.member).toBe("alice");
    expect(entry.team).toBe("Platform");
    expect(entry.org).toBe("Acme");
    expect(entry.orgType).toBe("core");
  });

  it("aggregates across multiple weeks for the same member", () => {
    const records = [
      makeRecord({
        member: "alice",
        week: "2026-W07",
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
      makeRecord({
        member: "alice",
        week: "2026-W08",
        filetype: {
          app: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 80, deletions: 10 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = computeLeaderboard(records, weeks);
    const overall = result[0];

    // alice overall: (100+20) + (80+10) = 210
    expect(overall.entries[0].value).toBe(210);
    expect(overall.entries[0].filetype.app).toBe(210);
  });

  it("defaults topN to 5", () => {
    const members = ["a", "b", "c", "d", "e", "f", "g"];
    const records = members.map((m, i) =>
      makeRecord({
        member: m,
        week: "2026-W08",
        filetype: {
          app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: (i + 1) * 100, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    );

    const result = computeLeaderboard(records, weeks);

    for (const col of result) {
      expect(col.entries.length).toBeLessThanOrEqual(5);
    }
  });
});
