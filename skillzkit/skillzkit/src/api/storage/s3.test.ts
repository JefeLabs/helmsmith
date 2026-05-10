import { describe, expect, it } from "vitest";
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
  S3CatalogStorage,
  type S3GetResult,
  type S3Like,
  type S3PutOptions,
  type S3PutResult,
  S3NotFoundError,
  S3PreconditionFailedError,
  encodeKey,
} from "./s3.js";

/**
 * In-memory S3Like implementation that simulates real S3 semantics:
 * - getObject throws S3NotFoundError when key absent
 * - putObject with ifMatch throws S3PreconditionFailedError on
 *   ETag mismatch
 * - putObject with ifNoneMatch="*" throws S3PreconditionFailedError
 *   if the object exists
 * - ETags are computed as a monotonic counter (good enough for tests)
 */
class InMemoryS3 implements S3Like {
  private objects = new Map<string, { body: string; etag: string }>();
  private etagCounter = 0;
  /** Test hooks */
  public getCount = 0;
  public putCount = 0;
  public preconditionFailures = 0;

  async getObject(key: string): Promise<S3GetResult> {
    this.getCount++;
    const obj = this.objects.get(key);
    if (!obj) throw new S3NotFoundError(`In-memory key not found: ${key}`);
    return { body: obj.body, etag: obj.etag };
  }

  async putObject(
    key: string,
    body: string,
    options: S3PutOptions = {},
  ): Promise<S3PutResult> {
    this.putCount++;
    const existing = this.objects.get(key);

    if (options.ifMatch !== undefined) {
      if (!existing || existing.etag !== options.ifMatch) {
        this.preconditionFailures++;
        throw new S3PreconditionFailedError();
      }
    }
    if (options.ifNoneMatch === "*") {
      if (existing) {
        this.preconditionFailures++;
        throw new S3PreconditionFailedError();
      }
    }

    const etag = `etag-${++this.etagCounter}`;
    this.objects.set(key, { body, etag });
    return { etag };
  }

  /** Test helper: directly mutate an object (simulate another writer). */
  rawWrite(key: string, body: string): string {
    const etag = `etag-${++this.etagCounter}`;
    this.objects.set(key, { body, etag });
    return etag;
  }

  /** Test helper: list keys matching a prefix. */
  keysWithPrefix(prefix: string): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

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

describe("S3CatalogStorage - basic round trip", () => {
  it("returns null for unknown slugs on empty storage", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
    expect(await s.getCommand("nope")).toBe(null);
    expect(await s.getSkill("nope")).toBe(null);
    expect(await s.getWorkflow("nope:nope")).toBe(null);
  });

  it("getIndex returns empty arrays on empty storage", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
    const index = await s.getIndex();
    expect(index.commands).toEqual([]);
    expect(index.skills).toEqual([]);
    expect(index.workflows).toEqual([]);
  });

  it("put then get specific version returns the artifact", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
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
    const s = new S3CatalogStorage(new InMemoryS3());
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
});

describe("S3CatalogStorage - version invariants", () => {
  it("rejects republishing the same version", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
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

  it("rejects different author overwriting existing slug", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
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
    const s = new S3CatalogStorage(new InMemoryS3());
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

describe("S3CatalogStorage - promotion", () => {
  it("promote moves the pointer", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
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
  });

  it("promote throws on unknown version", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
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

describe("S3CatalogStorage - on-disk shape", () => {
  it("uses the configured prefix on every key", async () => {
    const s3 = new InMemoryS3();
    const s = new S3CatalogStorage(s3, { prefix: "test-prefix/" });
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    const keys = s3.keysWithPrefix("test-prefix/");
    expect(keys).toContain("test-prefix/registry.json");
    expect(keys).toContain("test-prefix/commands/core__tools__foo@1.0.0.json");
  });

  it("default prefix is v1/", async () => {
    const s3 = new InMemoryS3();
    const s = new S3CatalogStorage(s3);
    await s.putCommand({
      command: makeCommand("foo:bar"),
      version: "1.0.0",
      author: alice,
    });
    expect(s3.keysWithPrefix("v1/")).toContain("v1/registry.json");
  });

  it("encodeKey replaces colons with double-underscore", () => {
    expect(encodeKey("core:tools:foo")).toBe("core__tools__foo");
  });

  it("includes commands, skills, and workflows independently", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
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

describe("S3CatalogStorage - durability across instances", () => {
  it("a fresh storage instance against the same S3 sees prior state", async () => {
    const s3 = new InMemoryS3();
    const s1 = new S3CatalogStorage(s3);
    await s1.putCommand({
      command: makeCommand("core:tools:foo", "v1"),
      version: "1.0.0",
      author: alice,
    });
    await s1.promoteCommand("core:tools:foo", "1.0.0");

    const s2 = new S3CatalogStorage(s3);
    const cmd = await s2.getCommand("core:tools:foo");
    expect(cmd?.body).toBe("v1");
  });
});

describe("S3CatalogStorage - ETag-based concurrency", () => {
  it("uses ifNoneMatch on the first registry write (true initial write)", async () => {
    const s3 = new InMemoryS3();
    const s = new S3CatalogStorage(s3);

    // Wrap putObject to record the conditional-write options we
    // saw on the registry write. The first put against an empty
    // bucket must use `ifNoneMatch: "*"` so a concurrent first-writer
    // can't silently clobber our state.
    let registryWriteOptions: S3PutOptions | undefined;
    const origPut = s3.putObject.bind(s3);
    s3.putObject = async (key, body, options) => {
      if (key === "v1/registry.json") registryWriteOptions = options;
      return origPut(key, body, options);
    };

    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    expect(registryWriteOptions?.ifNoneMatch).toBe("*");
    expect(registryWriteOptions?.ifMatch).toBeUndefined();
  });

  it("uses ifMatch on subsequent registry writes", async () => {
    const s3 = new InMemoryS3();
    const s = new S3CatalogStorage(s3);

    // First put establishes the registry
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });

    // Capture the second registry write's conditional options
    let secondWriteOptions: S3PutOptions | undefined;
    const origPut = s3.putObject.bind(s3);
    s3.putObject = async (key, body, options) => {
      if (key === "v1/registry.json" && !secondWriteOptions) {
        secondWriteOptions = options;
      }
      return origPut(key, body, options);
    };

    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.1",
      author: alice,
    });
    expect(secondWriteOptions?.ifMatch).toBeDefined();
    expect(secondWriteOptions?.ifNoneMatch).toBeUndefined();
  });

  it("retries on ifMatch precondition failure when registry is mutated externally", async () => {
    const s3 = new InMemoryS3();
    const s = new S3CatalogStorage(s3);

    // Initial put - establishes registry
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });
    const failuresBefore = s3.preconditionFailures;

    // Wrap getObject to mutate the registry between read and write,
    // simulating another writer racing.
    const origGet = s3.getObject.bind(s3);
    let interceptedOnce = false;
    s3.getObject = async (key: string) => {
      const result = await origGet(key);
      if (key === "v1/registry.json" && !interceptedOnce) {
        interceptedOnce = true;
        // Race: another writer mutates the registry
        s3.rawWrite(
          key,
          JSON.stringify(JSON.parse(result.body)),
        );
      }
      return result;
    };

    // This put should now hit a precondition failure on first
    // attempt, retry, succeed.
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.1",
      author: alice,
    });
    expect(s3.preconditionFailures).toBeGreaterThan(failuresBefore);
    const versions = await s.listCommandVersions("core:tools:foo");
    expect(versions).toHaveLength(2);
  });

  it("gives up after maxRetries and surfaces the precondition error", async () => {
    const s3 = new InMemoryS3();
    const s = new S3CatalogStorage(s3, { maxRetries: 2 });

    // Always racing: every getObject of registry.json mutates it
    // immediately so no put can ever succeed.
    const origGet = s3.getObject.bind(s3);
    s3.getObject = async (key: string) => {
      const result = await origGet(key);
      if (key === "v1/registry.json") {
        s3.rawWrite(key, result.body);
      }
      return result;
    };

    // First put creates the registry (no race possible since it
    // doesn't exist yet) - succeeds.
    await s.putCommand({
      command: makeCommand("core:tools:foo"),
      version: "1.0.0",
      author: alice,
    });

    // Second put hits the perpetual race - eventually exhausts retries.
    await expect(
      s.putCommand({
        command: makeCommand("core:tools:foo"),
        version: "1.0.1",
        author: alice,
      }),
    ).rejects.toThrow();
  });
});

describe("S3CatalogStorage - intra-process serialization", () => {
  it("concurrent puts of different versions serialize correctly", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
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
  });

  it("concurrent puts of the same version - exactly one wins", async () => {
    const s = new S3CatalogStorage(new InMemoryS3());
    const ops = Array.from({ length: 5 }, () =>
      s
        .putCommand({
          command: makeCommand("core:tools:foo"),
          version: "1.0.0",
          author: alice,
        })
        .then(() => "ok" as const)
        .catch((err) =>
          err instanceof VersionConflictError ? "conflict" : "other",
        ),
    );
    const results = await Promise.all(ops);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "conflict")).toHaveLength(4);
  });
});
