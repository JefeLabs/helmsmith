import { describe, it, expect } from "vitest";
import type { Config, AuthorRegistry, UserWeekRepoRecord } from "../types/schema.js";
import { buildAuthorMap, resolveAuthor, reattributeRecords, extractGitHubHandle } from "../collector/author-map.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSampleConfig(): Config {
  return {
    repos: [
      { path: "/repos/frontend", name: "frontend", group: "web" },
    ],
    orgs: [
      {
        name: "Acme Corp",
        type: "core",
        teams: [
          {
            name: "Platform",
            tag: "infra",
            members: [
              {
                name: "Alice Johnson",
                email: "alice@acme.com",
                aliases: ["alicej", "alice.johnson@old.com"],
              },
              {
                name: "Bob Smith",
                email: "bob@acme.com",
                aliases: [],
              },
            ],
          },
          {
            name: "Mobile",
            tag: "mobile",
            members: [
              {
                name: "Charlie Brown",
                // no email
                aliases: ["charlie"],
              },
            ],
          },
        ],
      },
      {
        name: "ExtDev Inc",
        type: "consultant",
        teams: [
          {
            name: "Contractors",
            tag: "default",
            members: [
              {
                name: "Dana White",
                email: "dana@extdev.io",
                aliases: ["dw"],
              },
            ],
          },
        ],
      },
    ],
    groups: {},
    tags: {},
    settings: { weeks_back: 12, staleness_minutes: 60, trend_threshold: 0.10 },
  };
}

// ── buildAuthorMap ──────────────────────────────────────────────────────────

describe("buildAuthorMap", () => {
  it("indexes members by email (lowercase)", () => {
    const config = makeSampleConfig();
    const map = buildAuthorMap(config);

    const entry = map.get("alice@acme.com");
    expect(entry).toBeDefined();
    expect(entry!.member).toBe("Alice Johnson");
    expect(entry!.org).toBe("Acme Corp");
    expect(entry!.orgType).toBe("core");
    expect(entry!.team).toBe("Platform");
    expect(entry!.tag).toBe("infra");
  });

  it("indexes members by name (lowercase)", () => {
    const config = makeSampleConfig();
    const map = buildAuthorMap(config);

    const entry = map.get("alice johnson");
    expect(entry).toBeDefined();
    expect(entry!.member).toBe("Alice Johnson");
  });

  it("indexes members by each alias (lowercase)", () => {
    const config = makeSampleConfig();
    const map = buildAuthorMap(config);

    const byAlias1 = map.get("alicej");
    expect(byAlias1).toBeDefined();
    expect(byAlias1!.member).toBe("Alice Johnson");

    const byAlias2 = map.get("alice.johnson@old.com");
    expect(byAlias2).toBeDefined();
    expect(byAlias2!.member).toBe("Alice Johnson");
  });

  it("handles members without email", () => {
    const config = makeSampleConfig();
    const map = buildAuthorMap(config);

    // Charlie has no email but should be findable by name
    const byName = map.get("charlie brown");
    expect(byName).toBeDefined();
    expect(byName!.member).toBe("Charlie Brown");
    expect(byName!.email).toBe("");
    expect(byName!.team).toBe("Mobile");
  });

  it("handles consultant org type correctly", () => {
    const config = makeSampleConfig();
    const map = buildAuthorMap(config);

    const entry = map.get("dana@extdev.io");
    expect(entry).toBeDefined();
    expect(entry!.orgType).toBe("consultant");
    expect(entry!.org).toBe("ExtDev Inc");
  });

  it("populates githubHandle from config members", () => {
    const config = makeSampleConfig();
    config.orgs[0].teams[0].members[0].githubHandle = "alicejohnson";
    const map = buildAuthorMap(config);

    const entry = map.get("alice@acme.com");
    expect(entry).toBeDefined();
    expect(entry!.githubHandle).toBe("alicejohnson");
  });

  it("leaves githubHandle undefined when not configured", () => {
    const config = makeSampleConfig();
    const map = buildAuthorMap(config);

    const entry = map.get("bob@acme.com");
    expect(entry).toBeDefined();
    expect(entry!.githubHandle).toBeUndefined();
  });

  it("populates githubHandle from author registry", () => {
    const config = makeSampleConfig();
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "new@dev.com": {
          email: "new@dev.com",
          name: "New Dev",
          githubHandle: "newdev-gh",
          org: "Acme Corp",
          team: "Platform",
          firstSeen: "2026-01-01",
          lastSeen: "2026-02-25",
          reposSeenIn: ["frontend"],
          commitCount: 50,
        },
      },
    };
    const map = buildAuthorMap(config, registry);

    const entry = map.get("new@dev.com");
    expect(entry).toBeDefined();
    expect(entry!.githubHandle).toBe("newdev-gh");
  });

  it("all keys for same member point to same resolved author object", () => {
    const config = makeSampleConfig();
    const map = buildAuthorMap(config);

    const byEmail = map.get("alice@acme.com");
    const byName = map.get("alice johnson");
    const byAlias = map.get("alicej");

    expect(byEmail).toBe(byName);
    expect(byEmail).toBe(byAlias);
  });
});

// ── resolveAuthor ────────────────────────────────────────────────────────────

describe("resolveAuthor", () => {
  it("resolves by email first", () => {
    const map = buildAuthorMap(makeSampleConfig());
    const result = resolveAuthor(map, "alice@acme.com", "Someone Else");

    expect(result).not.toBeNull();
    expect(result!.member).toBe("Alice Johnson");
  });

  it("falls back to name when email not found", () => {
    const map = buildAuthorMap(makeSampleConfig());
    const result = resolveAuthor(map, "unknown@nowhere.com", "Bob Smith");

    expect(result).not.toBeNull();
    expect(result!.member).toBe("Bob Smith");
  });

  it("returns null for unmatched author", () => {
    const map = buildAuthorMap(makeSampleConfig());
    const result = resolveAuthor(map, "nobody@nowhere.com", "Unknown Person");

    expect(result).toBeNull();
  });

  it("is case-insensitive for email", () => {
    const map = buildAuthorMap(makeSampleConfig());
    const result = resolveAuthor(map, "ALICE@ACME.COM", "");

    expect(result).not.toBeNull();
    expect(result!.member).toBe("Alice Johnson");
  });

  it("is case-insensitive for name", () => {
    const map = buildAuthorMap(makeSampleConfig());
    const result = resolveAuthor(map, "nope@nope.com", "BOB SMITH");

    expect(result).not.toBeNull();
    expect(result!.member).toBe("Bob Smith");
  });

  it("resolves by alias when both email and name fail", () => {
    const map = buildAuthorMap(makeSampleConfig());
    // The alias "charlie" is indexed by buildAuthorMap
    const result = resolveAuthor(map, "nope@nope.com", "charlie");

    expect(result).not.toBeNull();
    expect(result!.member).toBe("Charlie Brown");
  });

  it("prefers email over name when both match different authors", () => {
    const map = buildAuthorMap(makeSampleConfig());
    // Email matches Alice, name matches Bob
    const result = resolveAuthor(map, "alice@acme.com", "Bob Smith");

    expect(result).not.toBeNull();
    expect(result!.member).toBe("Alice Johnson");
  });
});

// ── reattributeRecords ──────────────────────────────────────────────────────

function makeRecord(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: "jose-skoolscout",
    email: "jose@skoolscout.com",
    org: "unassigned",
    orgType: "core",
    team: "unassigned",
    tag: "default",
    week: "2026-W08",
    repo: "frontend-app",
    group: "web",
    commits: 10,
    activeDays: 3,
    filetype: {
      app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
      test: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 5 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

describe("reattributeRecords", () => {
  it("updates records when author is now assigned in registry", () => {
    const config = makeSampleConfig();
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "jose@skoolscout.com": {
          email: "jose@skoolscout.com",
          name: "jose-skoolscout",
          org: "Acme Corp",
          team: "Platform",
          firstSeen: "2026-01-01",
          lastSeen: "2026-02-25",
          reposSeenIn: ["frontend-app"],
          commitCount: 100,
        },
      },
    };

    const records = [makeRecord()];
    const result = reattributeRecords(records, config, registry);

    expect(result).toHaveLength(1);
    expect(result[0].org).toBe("Acme Corp");
    expect(result[0].orgType).toBe("core");
    expect(result[0].team).toBe("Platform");
    expect(result[0].tag).toBe("infra");
  });

  it("leaves records unchanged when no matching author found", () => {
    const config = makeSampleConfig();
    const records = [makeRecord({ email: "unknown@nowhere.com", member: "Unknown" })];
    const result = reattributeRecords(records, config);

    expect(result[0].org).toBe("unassigned");
    expect(result[0].team).toBe("unassigned");
  });

  it("does not mutate the original records array", () => {
    const config = makeSampleConfig();
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "jose@skoolscout.com": {
          email: "jose@skoolscout.com",
          name: "jose-skoolscout",
          org: "Acme Corp",
          team: "Platform",
          firstSeen: "2026-01-01",
          lastSeen: "2026-02-25",
          reposSeenIn: ["frontend-app"],
          commitCount: 100,
        },
      },
    };

    const original = makeRecord();
    const records = [original];
    reattributeRecords(records, config, registry);

    expect(original.org).toBe("unassigned");
  });

  it("skips records already correctly attributed", () => {
    const config = makeSampleConfig();
    const record = makeRecord({
      email: "alice@acme.com",
      member: "Alice Johnson",
      org: "Acme Corp",
      orgType: "core",
      team: "Platform",
      tag: "infra",
    });
    const records = [record];
    const result = reattributeRecords(records, config);

    // Same object reference when nothing changed
    expect(result[0]).toBe(record);
  });
});

describe("extractGitHubHandle", () => {
  it("extracts handle from simple noreply email", () => {
    expect(extractGitHubHandle("octocat@users.noreply.github.com")).toBe("octocat");
  });

  it("extracts handle from numeric+username noreply email", () => {
    expect(extractGitHubHandle("12345+octocat@users.noreply.github.com")).toBe("octocat");
  });

  it("returns null for regular email", () => {
    expect(extractGitHubHandle("user@example.com")).toBeNull();
  });

  it("returns null for non-noreply github email", () => {
    expect(extractGitHubHandle("user@github.com")).toBeNull();
  });
});

describe("buildAuthorMap GitHub handle auto-extraction", () => {
  it("auto-fills githubHandle from noreply email on config members", () => {
    const config = makeSampleConfig();
    config.orgs[0].teams[0].members.push({
      name: "Noreply User",
      email: "12345+noreplyuser@users.noreply.github.com",
      aliases: [],
    });
    const map = buildAuthorMap(config);
    const resolved = map.get("12345+noreplyuser@users.noreply.github.com");
    expect(resolved?.githubHandle).toBe("noreplyuser");
  });

  it("does not override explicit githubHandle with noreply extraction", () => {
    const config = makeSampleConfig();
    config.orgs[0].teams[0].members.push({
      name: "Explicit User",
      email: "12345+wrongname@users.noreply.github.com",
      githubHandle: "correctname",
      aliases: [],
    });
    const map = buildAuthorMap(config);
    const resolved = map.get("12345+wrongname@users.noreply.github.com");
    expect(resolved?.githubHandle).toBe("correctname");
  });

  it("resolveAuthor auto-fills githubHandle from noreply email on lookup", () => {
    const config = makeSampleConfig();
    // Add a member with a regular email (no noreply, no githubHandle)
    config.orgs[0].teams[0].members.push({
      name: "Regular User",
      email: "regular@example.com",
      aliases: [],
    });
    const map = buildAuthorMap(config);
    // Resolve using a noreply email that matches the name
    const resolved = resolveAuthor(map, "12345+regulargh@users.noreply.github.com", "Regular User");
    // Should find via name lookup and auto-fill githubHandle from the noreply email
    expect(resolved?.githubHandle).toBe("regulargh");
  });
});
