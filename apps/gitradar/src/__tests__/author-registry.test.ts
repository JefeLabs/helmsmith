import { describe, it, expect } from "vitest";
import type { AuthorRegistry } from "../types/schema.js";
import {
  extractIdentifier,
  mergeDiscoveredAuthors,
  assignAuthor,
  assignByIdentifierPrefix,
  getUnassignedAuthors,
  getAssignedAuthors,
  getIdentifierPrefixes,
} from "../store/author-registry.js";

function emptyRegistry(): AuthorRegistry {
  return { version: 1, authors: {} };
}

describe("extractIdentifier", () => {
  it("extracts identifier from parenthesized code in name", () => {
    expect(extractIdentifier("Edwin Cruz (CONEWC)")).toBe("CONEWC");
  });

  it("returns undefined when no parenthesized code exists", () => {
    expect(extractIdentifier("Alice Smith")).toBeUndefined();
  });

  it("extracts first parenthesized code", () => {
    expect(extractIdentifier("John (ACN123) Doe")).toBe("ACN123");
  });

  it("ignores non-alphanumeric content in parentheses", () => {
    expect(extractIdentifier("Bob (hello world)")).toBeUndefined();
  });
});

describe("mergeDiscoveredAuthors", () => {
  it("adds new authors to empty registry", () => {
    const registry = emptyRegistry();
    const result = mergeDiscoveredAuthors(registry, [
      { email: "alice@acme.com", name: "Alice (ACN01)", repoName: "frontend", commitCount: 5, date: "2026-02-20" },
    ]);

    const author = result.authors["alice@acme.com"];
    expect(author).toBeDefined();
    expect(author.name).toBe("Alice (ACN01)");
    expect(author.identifier).toBe("ACN01");
    expect(author.commitCount).toBe(5);
    expect(author.reposSeenIn).toEqual(["frontend"]);
  });

  it("updates existing author with new repo and commit count", () => {
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "alice@acme.com": {
          email: "alice@acme.com",
          name: "Alice (ACN01)",
          identifier: "ACN01",
          firstSeen: "2026-01-01",
          lastSeen: "2026-01-15",
          reposSeenIn: ["frontend"],
          commitCount: 10,
        },
      },
    };

    const result = mergeDiscoveredAuthors(registry, [
      { email: "alice@acme.com", name: "Alice (ACN01)", repoName: "backend", commitCount: 3, date: "2026-02-20" },
    ]);

    const author = result.authors["alice@acme.com"];
    expect(author.commitCount).toBe(13);
    expect(author.reposSeenIn).toContain("frontend");
    expect(author.reposSeenIn).toContain("backend");
    expect(author.lastSeen).toBe("2026-02-20");
    expect(author.firstSeen).toBe("2026-01-01");
  });

  it("handles case-insensitive email keys", () => {
    const result = mergeDiscoveredAuthors(emptyRegistry(), [
      { email: "Alice@Acme.COM", name: "Alice", repoName: "repo", commitCount: 1, date: "2026-01-01" },
    ]);
    expect(result.authors["alice@acme.com"]).toBeDefined();
  });

  it("does not mutate original registry", () => {
    const registry = emptyRegistry();
    const result = mergeDiscoveredAuthors(registry, [
      { email: "a@b.com", name: "A", repoName: "r", commitCount: 1, date: "2026-01-01" },
    ]);
    expect(Object.keys(registry.authors)).toHaveLength(0);
    expect(Object.keys(result.authors)).toHaveLength(1);
  });
});

describe("assignAuthor", () => {
  it("assigns org and team to an existing author", () => {
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "alice@acme.com": {
          email: "alice@acme.com",
          name: "Alice",
          firstSeen: "2026-01-01",
          lastSeen: "2026-01-01",
          reposSeenIn: ["r"],
          commitCount: 1,
        },
      },
    };

    const result = assignAuthor(registry, "alice@acme.com", "Accenture", "Platform");
    expect(result.authors["alice@acme.com"].org).toBe("Accenture");
    expect(result.authors["alice@acme.com"].team).toBe("Platform");
  });

  it("returns unchanged registry for unknown email", () => {
    const registry = emptyRegistry();
    const result = assignAuthor(registry, "nobody@x.com", "Org", "Team");
    expect(result).toBe(registry);
  });
});

describe("assignByIdentifierPrefix", () => {
  it("assigns all unassigned authors matching prefix", () => {
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "a@x.com": {
          email: "a@x.com", name: "A (ACN01)", identifier: "ACN01",
          firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1,
        },
        "b@x.com": {
          email: "b@x.com", name: "B (ACN02)", identifier: "ACN02",
          firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 2,
        },
        "c@x.com": {
          email: "c@x.com", name: "C (INF01)", identifier: "INF01",
          firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 3,
        },
      },
    };

    const { registry: updated, assignedCount } = assignByIdentifierPrefix(
      registry, "ACN", "Accenture", "General",
    );

    expect(assignedCount).toBe(2);
    expect(updated.authors["a@x.com"].org).toBe("Accenture");
    expect(updated.authors["b@x.com"].org).toBe("Accenture");
    expect(updated.authors["c@x.com"].org).toBeUndefined();
  });

  it("skips already-assigned authors", () => {
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "a@x.com": {
          email: "a@x.com", name: "A (ACN01)", identifier: "ACN01",
          org: "Already", team: "Assigned",
          firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1,
        },
      },
    };

    const { assignedCount } = assignByIdentifierPrefix(
      registry, "ACN", "Accenture", "General",
    );
    expect(assignedCount).toBe(0);
  });

  it("is case-insensitive on prefix matching", () => {
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "a@x.com": {
          email: "a@x.com", name: "A (acn01)", identifier: "acn01",
          firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1,
        },
      },
    };

    const { assignedCount } = assignByIdentifierPrefix(
      registry, "ACN", "Accenture", "General",
    );
    expect(assignedCount).toBe(1);
  });
});

describe("getUnassignedAuthors / getAssignedAuthors", () => {
  const registry: AuthorRegistry = {
    version: 1,
    authors: {
      "a@x.com": {
        email: "a@x.com", name: "A", org: "Org", team: "Team",
        firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1,
      },
      "b@x.com": {
        email: "b@x.com", name: "B",
        firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 2,
      },
    },
  };

  it("returns only unassigned authors", () => {
    const unassigned = getUnassignedAuthors(registry);
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].email).toBe("b@x.com");
  });

  it("returns only assigned authors", () => {
    const assigned = getAssignedAuthors(registry);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].email).toBe("a@x.com");
  });
});

describe("getIdentifierPrefixes", () => {
  it("groups authors by identifier prefix", () => {
    const registry: AuthorRegistry = {
      version: 1,
      authors: {
        "a@x.com": { email: "a@x.com", name: "A", identifier: "ACN01", org: "Accenture", team: "T", firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1 },
        "b@x.com": { email: "b@x.com", name: "B", identifier: "ACN02", firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1 },
        "c@x.com": { email: "c@x.com", name: "C", identifier: "INF01", firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1 },
        "d@x.com": { email: "d@x.com", name: "D", firstSeen: "2026-01-01", lastSeen: "2026-01-01", reposSeenIn: ["r"], commitCount: 1 },
      },
    };

    const prefixes = getIdentifierPrefixes(registry);
    expect(prefixes.get("AC")).toEqual({ count: 2, assigned: 1, unassigned: 1 });
    expect(prefixes.get("IN")).toEqual({ count: 1, assigned: 0, unassigned: 1 });
    expect(prefixes.has("D")).toBeFalsy(); // no identifier
  });
});
