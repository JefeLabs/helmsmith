import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AuthorIdentity,
  Command,
  Skill,
  Workflow,
} from "../contracts.js";
import {
  AuthorMismatchError,
  VersionConflictError,
  VersionNotFoundError,
} from "./interface.js";
import {
  FilesystemPersistentCatalogStorage,
  encodeKey,
  listArtifactFiles,
} from "./fs-persistent.js";

const alice: AuthorIdentity = {
  id: "u_alice",
  displayName: "Alice",
  email: "alice@example.com",
};
const bob: AuthorIdentity = {
  id: "u_bob",
  displayName: "Bob",
  email: "bob@example.com",
};

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "skillzkit-fsp-test-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeCommand(slug: string, body = "body"): Command {
  return {
    slug,
    path: `${slug.replace(/:/g, "/")}.md`,
    kind: "command",
    description: `desc for ${slug}`,
    references: [],
    referencedBy: [],
    body,
    frontmatter: {},
  };
}
function makeSkill(name: string): Skill {
  return {
    name,
    path: `${name}/SKILL.md`,
    description: `skill ${name}`,
    references: [],
    body: "body",
    frontmatter: {},
  };
}
function makeWorkflow(qualifiedName: string): Workflow {
  const [domain, slug] = qualifiedName.split(":");
  return {
    qualifiedName,
    domain,
    slug,
    commandSlug: `${domain}:workflows:${slug}`,
    description: `wf ${qualifiedName}`,
    references: [],
    body: "body",
    frontmatter: {},
  };
}

describe("FilesystemPersistentCatalogStorage - basic round trip", () => {
  it("returns null for unknown slugs on empty storage", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    expect(await s.getCommand("nope")).toBe(null);
    expect(await s.getSkill("nope")).toBe(null);
    expect(await s.getWorkflow("nope:nope")).toBe(null);
  });

  it("getIndex returns empty arrays on empty storage", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    const index = await s.getIndex();
    expect(index.commands).toEqual([]);
    expect(index.skills).toEqual([]);
    expect(index.workflows).toEqual([]);
  });

  it("put then get specific version returns the artifact (round trip)", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo", "real-body"),
      version: "1.0.0",
      author: alice,
    });
    const recovered = await s.getCommandVersion("core:tools:foo", "1.0.0");
    expect(recovered).toMatchObject({
      slug: "core:tools:foo",
      body: "real-body",
    });
  });

  it("a fresh put lands as unpromoted; getCommand returns null until promote", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    expect(await s.getCommand("core:tools:foo")).toBe(null);
    await s.promoteCommand("core:tools:foo", "1.0.0");
    expect(await s.getCommand("core:tools:foo")).toMatchObject({
      slug: "core:tools:foo",
    });
  });

  it("survives a fresh storage instance (state is durable on disk)", async () => {
    const s1 = new FilesystemPersistentCatalogStorage(tempRoot);
    await s1.putCommand({
      command: makeCommand("core:tools:foo", "v1"),
      version: "1.0.0",
      author: alice,
    });
    await s1.promoteCommand("core:tools:foo", "1.0.0");

    // New instance, same root - state persists across instances
    const s2 = new FilesystemPersistentCatalogStorage(tempRoot);
    const cmd = await s2.getCommand("core:tools:foo");
    expect(cmd?.body).toBe("v1");
  });
});

describe("FilesystemPersistentCatalogStorage - version invariants", () => {
  it("rejects republishing the same version", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    await expect(
      s.putCommand({
        command: makeCommand("core:tools:foo", "different"),
        version: "1.0.0",
        author: alice,
      }),
    ).rejects.toThrow(VersionConflictError);
  });

  it("allows author of record to publish additional versions", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.1.0",
      author: alice,
    });
    const versions = await s.listCommandVersions("core:tools:foo");
    expect(versions.map((v) => v.version)).toEqual(["1.0.0", "1.1.0"]);
  });

  it("rejects different author overwriting existing slug", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    await expect(
      s.putCommand({
        command: makeCommand("core:tools:foo"),
        version: "2.0.0",
        author: bob,
      }),
    ).rejects.toThrow(AuthorMismatchError);
  });

  it("author check uses stable id, not display name", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    const aliceRenamed: AuthorIdentity = {
      id: alice.id,
      displayName: "Alice (renamed)",
      email: "alice2@example.com",
    };
    await expect(
      s.putCommand({
        command: makeCommand("core:tools:foo"),
        version: "1.1.0",
        author: aliceRenamed,
      }),
    ).resolves.toBeDefined();
  });
});

describe("FilesystemPersistentCatalogStorage - promotion", () => {
  it("promote moves the pointer; only one version is current at a time", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo", "v1"),
      version: "1.0.0",
      author: alice,
    });
    await s.putCommand({
      command: makeCommand("core:tools:foo", "v2"),
      version: "1.1.0",
      author: alice,
    });

    await s.promoteCommand("core:tools:foo", "1.0.0");
    expect((await s.getCommand("core:tools:foo"))?.body).toBe("v1");

    await s.promoteCommand("core:tools:foo", "1.1.0");
    expect((await s.getCommand("core:tools:foo"))?.body).toBe("v2");

    const versions = await s.listCommandVersions("core:tools:foo");
    expect(versions.map((v) => v.promoted)).toEqual([false, true]);
  });

  it("promote throws on unknown version", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    await expect(s.promoteCommand("core:tools:foo", "9.9.9")).rejects.toThrow(
      VersionNotFoundError,
    );
    await expect(s.promoteCommand("nope", "1.0.0")).rejects.toThrow(
      VersionNotFoundError,
    );
  });
});

describe("FilesystemPersistentCatalogStorage - index", () => {
  it("excludes unpromoted entries from the index", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    let index = await s.getIndex();
    expect(index.commands).toHaveLength(0);

    await s.promoteCommand("core:tools:foo", "1.0.0");
    index = await s.getIndex();
    expect(index.commands).toHaveLength(1);
    expect(index.commands[0].slug).toBe("core:tools:foo");
  });

  it("index summaries exclude the body field", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo", "this body should not be in the index"),
      version: "1.0.0",
      author: alice,
    });
    await s.promoteCommand("core:tools:foo", "1.0.0");
    const index = await s.getIndex();
    expect(index.commands[0]).not.toHaveProperty("body");
  });

  it("includes commands, skills, and workflows independently", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("a:b:c"),
      version: "1",
      author: alice,
    });
    await s.putSkill({
      skill: makeSkill("router-x"),
      version: "1",
      author: alice,
    });
    await s.putWorkflow({
      workflow: makeWorkflow("product:greenfield"),
      version: "1",
      author: alice,
    });
    await s.promoteCommand("a:b:c", "1");
    await s.promoteSkill("router-x", "1");
    await s.promoteWorkflow("product:greenfield", "1");

    const index = await s.getIndex();
    expect(index.commands).toHaveLength(1);
    expect(index.skills).toHaveLength(1);
    expect(index.workflows).toHaveLength(1);
  });
});

describe("FilesystemPersistentCatalogStorage - on-disk shape", () => {
  it("creates registry.json + per-version artifact files", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    expect(existsSync(join(tempRoot, "registry.json"))).toBe(true);
    const files = listArtifactFiles(tempRoot, "commands");
    expect(files).toContain("core__tools__foo@1.0.0.json");
  });

  it("encodeKey replaces colons with double-underscore", () => {
    expect(encodeKey("core:tools:foo")).toBe("core__tools__foo");
    expect(encodeKey("simple")).toBe("simple");
  });

  it("registry.json contains owner author id + version history", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    const reg = JSON.parse(
      readFileSync(join(tempRoot, "registry.json"), "utf8"),
    );
    expect(reg.commands["core:tools:foo"].ownerAuthorId).toBe("u_alice");
    expect(reg.commands["core:tools:foo"].versions).toHaveLength(1);
    expect(reg.commands["core:tools:foo"].currentVersion).toBe(null);
  });

  it("atomic writes leave no .tmp files behind on success", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    const all = listArtifactFiles(tempRoot, "commands");
    expect(all.every((f) => !f.includes(".tmp."))).toBe(true);
  });
});

describe("FilesystemPersistentCatalogStorage - mutation serialization", () => {
  it("concurrent puts of the same slug serialize correctly (no duplicate-version races)", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    // Fire 5 concurrent puts of the same slug + DIFFERENT versions.
    // All should succeed; final version count should be 5.
    const ops = ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4"].map((v) =>
      s.putCommand({
        command: makeCommand("core:tools:foo"),
        version: v,
        author: alice,
      }),
    );
    await Promise.all(ops);
    const versions = await s.listCommandVersions("core:tools:foo");
    expect(versions).toHaveLength(5);
    expect(versions.map((v) => v.version).sort()).toEqual([
      "1.0.0",
      "1.0.1",
      "1.0.2",
      "1.0.3",
      "1.0.4",
    ]);
  });

  it("concurrent puts of the same slug+version - exactly one wins", async () => {
    const s = new FilesystemPersistentCatalogStorage(tempRoot);
    const ops = Array.from({ length: 5 }, () =>
      s
        .putCommand({
          command: makeCommand("core:tools:foo"),
          version: "1.0.0",
          author: alice,
        })
        .then(() => "ok" as const)
        .catch((err) =>
          err instanceof VersionConflictError ? "conflict" : "other-error",
        ),
    );
    const results = await Promise.all(ops);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "conflict")).toHaveLength(4);
  });
});
