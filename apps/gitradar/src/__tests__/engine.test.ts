import { describe, it, expect } from "vitest";
import { rollup } from "../aggregator/engine.js";
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
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("rollup", () => {
  it("returns an empty map when given no records", () => {
    const result = rollup([], (r) => r.org);
    expect(result.size).toBe(0);
  });

  it("groups records by a single dimension (org)", () => {
    const records = [
      makeRecord({ org: "Acme", member: "alice", commits: 3 }),
      makeRecord({ org: "Acme", member: "bob", commits: 7 }),
      makeRecord({ org: "Globex", member: "carol", commits: 5 }),
    ];

    const result = rollup(records, (r) => r.org);

    expect(result.size).toBe(2);
    expect(result.has("Acme")).toBe(true);
    expect(result.has("Globex")).toBe(true);
  });

  it("sums commits across grouped records", () => {
    const records = [
      makeRecord({ org: "Acme", commits: 3 }),
      makeRecord({ org: "Acme", commits: 7 }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    expect(acme.commits).toBe(10);
  });

  it("sums activeDays across grouped records", () => {
    const records = [
      makeRecord({ member: "alice", activeDays: 3 }),
      makeRecord({ member: "bob", activeDays: 5 }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    expect(acme.activeDays).toBe(8);
  });

  it("computes insertions as sum of all filetype insertions", () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    // 100 (app) + 40 (test) + 15 (config) + 8 (storybook) = 163
    expect(acme.insertions).toBe(163);
  });

  it("computes deletions as sum of all filetype deletions", () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    // 20 (app) + 10 (test) + 5 (config) + 2 (storybook) = 37
    expect(acme.deletions).toBe(37);
  });

  it("computes netLines as insertions minus deletions", () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    // 163 - 37 = 126
    expect(acme.netLines).toBe(126);
  });

  it("computes filesChanged as sum of all filetype files", () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    // 10 (app) + 4 (test) + 2 (config) + 1 (storybook) = 17
    expect(acme.filesChanged).toBe(17);
  });

  it("tracks unique members for activeMembers count", () => {
    const records = [
      makeRecord({ member: "alice" }),
      makeRecord({ member: "alice" }),
      makeRecord({ member: "bob" }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    expect(acme.activeMembers).toBe(2);
  });

  it("sums filetype breakdown across records", () => {
    const records = [
      makeRecord({
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 50, deletions: 10 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 20, deletions: 5 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 2 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
      makeRecord({
        filetype: {
          app: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 8 },
          test: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 3 },
          config: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 12, deletions: 4 },
          storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 5, deletions: 1 },
          doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    expect(acme.filetype.app).toEqual({ files: 8, filesAdded: 0, filesDeleted: 0, insertions: 80, deletions: 18 });
    expect(acme.filetype.test).toEqual({ files: 3, filesAdded: 0, filesDeleted: 0, insertions: 35, deletions: 8 });
    expect(acme.filetype.config).toEqual({ files: 3, filesAdded: 0, filesDeleted: 0, insertions: 22, deletions: 6 });
    expect(acme.filetype.storybook).toEqual({ files: 1, filesAdded: 0, filesDeleted: 0, insertions: 5, deletions: 1 });
    expect(acme.filetype.doc).toEqual({ files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 });
  });

  it("groups by team dimension", () => {
    const records = [
      makeRecord({ team: "Platform", commits: 10 }),
      makeRecord({ team: "Frontend", commits: 8 }),
      makeRecord({ team: "Platform", commits: 4 }),
    ];

    const result = rollup(records, (r) => r.team);

    expect(result.size).toBe(2);
    expect(result.get("Platform")!.commits).toBe(14);
    expect(result.get("Frontend")!.commits).toBe(8);
  });

  it("groups by member dimension", () => {
    const records = [
      makeRecord({ member: "alice", commits: 10 }),
      makeRecord({ member: "bob", commits: 5 }),
      makeRecord({ member: "alice", commits: 3 }),
    ];

    const result = rollup(records, (r) => r.member);

    expect(result.size).toBe(2);
    expect(result.get("alice")!.commits).toBe(13);
    expect(result.get("bob")!.commits).toBe(5);
  });

  it("groups by week dimension", () => {
    const records = [
      makeRecord({ week: "2026-W07", commits: 10 }),
      makeRecord({ week: "2026-W08", commits: 5 }),
      makeRecord({ week: "2026-W07", commits: 3 }),
    ];

    const result = rollup(records, (r) => r.week);

    expect(result.size).toBe(2);
    expect(result.get("2026-W07")!.commits).toBe(13);
    expect(result.get("2026-W08")!.commits).toBe(5);
  });

  it("groups by composite key", () => {
    const records = [
      makeRecord({ org: "Acme", week: "2026-W07", commits: 10 }),
      makeRecord({ org: "Acme", week: "2026-W08", commits: 5 }),
      makeRecord({ org: "Globex", week: "2026-W07", commits: 3 }),
    ];

    const result = rollup(records, (r) => `${r.org}:${r.week}`);

    expect(result.size).toBe(3);
    expect(result.get("Acme:2026-W07")!.commits).toBe(10);
    expect(result.get("Acme:2026-W08")!.commits).toBe(5);
    expect(result.get("Globex:2026-W07")!.commits).toBe(3);
  });

  it("handles a single record correctly", () => {
    const records = [
      makeRecord({
        member: "alice",
        commits: 7,
        activeDays: 4,
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 50, deletions: 10 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 20, deletions: 5 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get("Acme")!;

    expect(acme.commits).toBe(7);
    expect(acme.activeDays).toBe(4);
    expect(acme.insertions).toBe(70);
    expect(acme.deletions).toBe(15);
    expect(acme.netLines).toBe(55);
    expect(acme.filesChanged).toBe(7);
    expect(acme.activeMembers).toBe(1);
  });
});
