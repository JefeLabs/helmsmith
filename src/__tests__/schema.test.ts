import { describe, expect, it } from "vitest";
import {
  MemberSchema,
  TeamSchema,
  OrgSchema,
  RepoSchema,
  ConfigSchema,
  UserWeekRepoRecordSchema,
  CommitsByFiletypeSchema,
  ScanStateSchema,
  WorkspaceRepoSchema,
  WorkspaceSchema,
  ReposRegistrySchema,
} from "../types/schema.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFiletype(overrides?: Partial<Record<string, unknown>>) {
  return {
    app: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 200, deletions: 50 },
    test: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 80, deletions: 20 },
    config: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
    storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 10 },
    ...overrides,
  };
}

function makeRecord(overrides?: Partial<Record<string, unknown>>) {
  return {
    member: "Alice Chen",
    email: "alice@company.com",
    org: "Team A",
    orgType: "core" as const,
    team: "Platform",
    tag: "infrastructure",
    week: "2026-W08",
    repo: "frontend-app",
    group: "web",
    commits: 42,
    activeDays: 5,
    filetype: makeFiletype(),
    ...overrides,
  };
}

// ── MemberSchema ────────────────────────────────────────────────────────────

describe("MemberSchema", () => {
  it("parses a valid member with all fields", () => {
    const result = MemberSchema.parse({
      name: "Alice Chen",
      email: "alice@company.com",
      aliases: ["alice.chen"],
    });
    expect(result.name).toBe("Alice Chen");
    expect(result.email).toBe("alice@company.com");
    expect(result.aliases).toEqual(["alice.chen"]);
  });

  it("defaults aliases to empty array when omitted", () => {
    const result = MemberSchema.parse({ name: "Bob" });
    expect(result.aliases).toEqual([]);
  });

  it("allows email to be optional", () => {
    const result = MemberSchema.parse({ name: "Carol" });
    expect(result.email).toBeUndefined();
  });

  it("rejects missing name", () => {
    expect(() => MemberSchema.parse({ email: "x@y.com" })).toThrow();
  });
});

// ── TeamSchema ──────────────────────────────────────────────────────────────

describe("TeamSchema", () => {
  it("parses a valid team", () => {
    const result = TeamSchema.parse({
      name: "Platform",
      tag: "infrastructure",
      members: [{ name: "Alice", email: "a@b.com" }],
    });
    expect(result.name).toBe("Platform");
    expect(result.tag).toBe("infrastructure");
    expect(result.members).toHaveLength(1);
  });

  it("defaults tag to 'default'", () => {
    const result = TeamSchema.parse({
      name: "Product",
      members: [{ name: "Bob" }],
    });
    expect(result.tag).toBe("default");
  });

  it("rejects team without members", () => {
    expect(() => TeamSchema.parse({ name: "Empty" })).toThrow();
  });
});

// ── OrgSchema ───────────────────────────────────────────────────────────────

describe("OrgSchema", () => {
  it("parses a valid org", () => {
    const result = OrgSchema.parse({
      name: "Team A",
      type: "core",
      teams: [{ name: "Platform", members: [{ name: "Alice" }] }],
    });
    expect(result.name).toBe("Team A");
    expect(result.type).toBe("core");
  });

  it("accepts 'consultant' type", () => {
    const result = OrgSchema.parse({
      name: "Team B",
      type: "consultant",
      teams: [{ name: "Squad", members: [{ name: "Leo" }] }],
    });
    expect(result.type).toBe("consultant");
  });

  it("rejects invalid org type", () => {
    expect(() =>
      OrgSchema.parse({
        name: "Bad",
        type: "freelancer",
        teams: [],
      })
    ).toThrow();
  });
});

// ── RepoSchema ──────────────────────────────────────────────────────────────

describe("RepoSchema", () => {
  it("parses a valid repo", () => {
    const result = RepoSchema.parse({
      path: "~/code/frontend-app",
      name: "frontend-app",
      group: "web",
    });
    expect(result.path).toBe("~/code/frontend-app");
    expect(result.name).toBe("frontend-app");
    expect(result.group).toBe("web");
  });

  it("defaults group to 'default'", () => {
    const result = RepoSchema.parse({ path: "/some/path" });
    expect(result.group).toBe("default");
  });

  it("allows name to be optional", () => {
    const result = RepoSchema.parse({ path: "/some/path" });
    expect(result.name).toBeUndefined();
  });

  it("rejects missing path", () => {
    expect(() => RepoSchema.parse({ name: "repo" })).toThrow();
  });
});

// ── ConfigSchema ────────────────────────────────────────────────────────────

describe("ConfigSchema", () => {
  it("parses a minimal valid config", () => {
    const result = ConfigSchema.parse({
      repos: [{ path: "~/code/app" }],
      orgs: [
        {
          name: "Team A",
          type: "core",
          teams: [{ name: "Dev", members: [{ name: "Alice" }] }],
        },
      ],
    });
    expect(result.repos).toHaveLength(1);
    expect(result.orgs).toHaveLength(1);
    expect(result.groups).toEqual({});
    expect(result.tags).toEqual({});
    expect(result.settings.weeks_back).toBe(12);
    expect(result.settings.staleness_minutes).toBe(60);
  });

  it("applies default settings", () => {
    const result = ConfigSchema.parse({
      repos: [{ path: "/p" }],
      orgs: [
        {
          name: "O",
          type: "core",
          teams: [{ name: "T", members: [{ name: "M" }] }],
        },
      ],
    });
    expect(result.settings).toEqual({
      weeks_back: 12,
      staleness_minutes: 60,
      trend_threshold: 0.10,
    });
  });

  it("allows overriding settings", () => {
    const result = ConfigSchema.parse({
      repos: [{ path: "/p" }],
      orgs: [
        {
          name: "O",
          type: "core",
          teams: [{ name: "T", members: [{ name: "M" }] }],
        },
      ],
      settings: { weeks_back: 24, staleness_minutes: 120 },
    });
    expect(result.settings.weeks_back).toBe(24);
    expect(result.settings.staleness_minutes).toBe(120);
  });

  it("parses groups and tags", () => {
    const result = ConfigSchema.parse({
      repos: [{ path: "/p" }],
      orgs: [
        {
          name: "O",
          type: "core",
          teams: [{ name: "T", members: [{ name: "M" }] }],
        },
      ],
      groups: { web: { label: "Web" }, backend: {} },
      tags: { feature: { label: "Feature" } },
    });
    expect(result.groups).toEqual({ web: { label: "Web" }, backend: {} });
    expect(result.tags).toEqual({ feature: { label: "Feature" } });
  });

  it("defaults repos to empty array when missing", () => {
    const result = ConfigSchema.parse({
      orgs: [
        {
          name: "O",
          type: "core",
          teams: [{ name: "T", members: [{ name: "M" }] }],
        },
      ],
    });
    expect(result.repos).toEqual([]);
  });

  it("defaults orgs to empty array when missing", () => {
    const result = ConfigSchema.parse({
      repos: [{ path: "/p" }],
    });
    expect(result.orgs).toEqual([]);
  });

  it("accepts optional workspace field", () => {
    const result = ConfigSchema.parse({
      workspace: "engineering",
      repos: [{ path: "/p" }],
      orgs: [
        {
          name: "O",
          type: "core",
          teams: [{ name: "T", members: [{ name: "M" }] }],
        },
      ],
    });
    expect(result.workspace).toBe("engineering");
  });

  it("parses without workspace field (undefined)", () => {
    const result = ConfigSchema.parse({
      repos: [{ path: "/p" }],
      orgs: [
        {
          name: "O",
          type: "core",
          teams: [{ name: "T", members: [{ name: "M" }] }],
        },
      ],
    });
    expect(result.workspace).toBeUndefined();
  });
});

// ── UserWeekRepoRecordSchema ────────────────────────────────────────────────

describe("UserWeekRepoRecordSchema", () => {
  it("parses a valid record", () => {
    const record = makeRecord();
    const result = UserWeekRepoRecordSchema.parse(record);
    expect(result.member).toBe("Alice Chen");
    expect(result.commits).toBe(42);
    expect(result.filetype.app.insertions).toBe(200);
  });

  it("rejects invalid orgType", () => {
    expect(() =>
      UserWeekRepoRecordSchema.parse(makeRecord({ orgType: "freelancer" }))
    ).toThrow();
  });

  it("rejects missing filetype fields", () => {
    expect(() =>
      UserWeekRepoRecordSchema.parse(
        makeRecord({
          filetype: { app: { files: 1, insertions: 2, deletions: 3 } },
        })
      )
    ).toThrow();
  });

  it("rejects non-numeric commits", () => {
    expect(() =>
      UserWeekRepoRecordSchema.parse(makeRecord({ commits: "many" }))
    ).toThrow();
  });

  it("rejects missing required identity fields", () => {
    const { member: _, ...noMember } = makeRecord();
    expect(() => UserWeekRepoRecordSchema.parse(noMember)).toThrow();
  });
});

// ── CommitsByFiletypeSchema ─────────────────────────────────────────────────

describe("CommitsByFiletypeSchema", () => {
  it("parses a valid commits-by-filetype document", () => {
    const result = CommitsByFiletypeSchema.parse({
      version: 1,
      lastUpdated: "2026-02-25T10:00:00Z",
      records: [makeRecord()],
    });
    expect(result.version).toBe(1);
    expect(result.records).toHaveLength(1);
  });

  it("parses with empty records", () => {
    const result = CommitsByFiletypeSchema.parse({
      version: 1,
      lastUpdated: "2026-02-25T10:00:00Z",
      records: [],
    });
    expect(result.records).toHaveLength(0);
  });

  it("rejects wrong version", () => {
    expect(() =>
      CommitsByFiletypeSchema.parse({
        version: 2,
        lastUpdated: "2026-02-25T10:00:00Z",
        records: [],
      })
    ).toThrow();
  });
});

// ── ScanStateSchema ─────────────────────────────────────────────────────────

describe("ScanStateSchema", () => {
  it("parses a valid scan state", () => {
    const result = ScanStateSchema.parse({
      version: 1,
      repos: {
        "frontend-app": {
          lastHash: "abc123",
          lastScanDate: "2026-02-25T10:00:00Z",
          recentHashes: ["abc123", "def456"],
          recordCount: 42,
        },
      },
    });
    expect(result.version).toBe(1);
    expect(result.repos["frontend-app"].lastHash).toBe("abc123");
    expect(result.repos["frontend-app"].recentHashes).toHaveLength(2);
  });

  it("parses with empty repos", () => {
    const result = ScanStateSchema.parse({
      version: 1,
      repos: {},
    });
    expect(Object.keys(result.repos)).toHaveLength(0);
  });

  it("rejects wrong version", () => {
    expect(() =>
      ScanStateSchema.parse({
        version: 2,
        repos: {},
      })
    ).toThrow();
  });

  it("rejects repo entry missing required fields", () => {
    expect(() =>
      ScanStateSchema.parse({
        version: 1,
        repos: {
          "bad-repo": {
            lastHash: "abc",
            // missing lastScanDate, recentHashes, recordCount
          },
        },
      })
    ).toThrow();
  });
});

// ── ReposRegistrySchema ────────────────────────────────────────────────────

describe("ReposRegistrySchema", () => {
  it("parses a valid registry with multiple workspaces", () => {
    const result = ReposRegistrySchema.parse({
      workspaces: {
        "~/code/work": {
          label: "Work Projects",
          repos: [
            { name: "frontend-app", path: "./frontend-app", group: "web", tags: ["react"] },
            { name: "api-service", path: "./api-service", group: "backend", tags: ["node"] },
          ],
        },
        "~/code/oss": {
          label: "Open Source",
          repos: [
            { name: "my-lib", path: "./my-lib", tags: ["typescript"] },
          ],
        },
      },
      groups: { web: { label: "Web" }, backend: { label: "Backend" } },
      tags: { react: { label: "React" }, node: { label: "Node.js" } },
    });
    expect(Object.keys(result.workspaces)).toHaveLength(2);
    expect(result.workspaces["~/code/work"].repos).toHaveLength(2);
    expect(result.workspaces["~/code/oss"].repos).toHaveLength(1);
    expect(result.groups).toEqual({ web: { label: "Web" }, backend: { label: "Backend" } });
    expect(result.tags).toEqual({ react: { label: "React" }, node: { label: "Node.js" } });
  });

  it("validates a single workspace with minimal config", () => {
    const result = ReposRegistrySchema.parse({
      workspaces: {
        "~/code": {
          repos: [{ name: "solo-repo" }],
        },
      },
    });
    expect(Object.keys(result.workspaces)).toHaveLength(1);
    expect(result.workspaces["~/code"].repos).toHaveLength(1);
    expect(result.workspaces["~/code"].label).toBeUndefined();
  });

  it("applies defaults for optional repo fields (group='default', tags=[])", () => {
    const result = ReposRegistrySchema.parse({
      workspaces: {
        "~/code": {
          repos: [{ name: "bare-repo" }],
        },
      },
    });
    const repo = result.workspaces["~/code"].repos[0];
    expect(repo.group).toBe("default");
    expect(repo.tags).toEqual([]);
  });

  it("defaults groups and tags to empty objects when omitted", () => {
    const result = ReposRegistrySchema.parse({
      workspaces: {
        "~/code": {
          repos: [{ name: "repo" }],
        },
      },
    });
    expect(result.groups).toEqual({});
    expect(result.tags).toEqual({});
  });

  it("allows repos without path field (exported/portable format)", () => {
    const result = ReposRegistrySchema.parse({
      workspaces: {
        "~/code": {
          repos: [
            { name: "portable-repo", group: "web", tags: ["ts"] },
          ],
        },
      },
    });
    const repo = result.workspaces["~/code"].repos[0];
    expect(repo.path).toBeUndefined();
    expect(repo.name).toBe("portable-repo");
  });

  it("rejects invalid workspace structure (missing repos array)", () => {
    expect(() =>
      ReposRegistrySchema.parse({
        workspaces: {
          "~/code": {
            label: "No repos here",
          },
        },
      })
    ).toThrow();
  });
});
