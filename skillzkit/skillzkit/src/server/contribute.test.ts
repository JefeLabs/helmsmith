import { beforeEach, describe, expect, it } from "vitest";
import type {
  AuthorIdentity,
  CreateContributionRequest,
} from "../api/contracts.js";
import { FixedAuthorVerifier } from "../api/auth.js";
import { MemoryCatalogStorage } from "../api/storage/memory.js";
import { createApp } from "./app.js";

/**
 * Tests run the contribute endpoint against an in-memory storage
 * with a FixedAuthorVerifier that accepts any non-empty token. Each
 * test gets its own storage so state doesn't leak between cases.
 */

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

function makeApp(author: AuthorIdentity = alice) {
  const storage = new MemoryCatalogStorage("0.0.0-test");
  const app = createApp({
    storage,
    writable: true,
    authVerifier: new FixedAuthorVerifier(author),
  });
  return { storage, app };
}

const url = (path: string) => `http://test${path}`;

const validCommand: CreateContributionRequest = {
  kind: "command",
  slug: "core:tools:my-tool",
  frontmatter: {
    description: "Helpful new tool",
    tags: ["accessibility"],
  },
  files: [
    {
      path: "core/tools/my-tool.md",
      content: "# my-tool\n\nDoes a thing.\n",
    },
  ],
};

function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  authHeader = "Bearer dev-token",
) {
  return app.fetch(
    new Request(url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/contributions - happy paths", () => {
  it("accepts a valid command, returns 201 + Location header", async () => {
    const { app } = makeApp();
    const res = await postJson(app, "/api/v1/contributions", validCommand);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe("command");
    expect(body.slug).toBe("core:tools:my-tool");
    expect(body.version).toBe("1.0.0");
    expect(body.status).toBe("accepted");
    expect(body.promoted).toBe(false);
    expect(body.author.id).toBe("u_alice");
    expect(body.id).toBe("command:core:tools:my-tool@1.0.0");
    expect(res.headers.get("Location")).toContain("contributions/");
  });

  it("derives next version from existing - patch bump by default", async () => {
    const { storage, app } = makeApp();
    // Pre-seed v1.0.0 from alice
    await storage.putCommand({
      command: {
        slug: "core:tools:my-tool",
        path: "core/tools/my-tool.md",
        kind: "command",
        description: "v1",
        references: [],
        referencedBy: [],
        body: "v1",
        frontmatter: {},
      },
      version: "1.0.0",
      author: alice,
    });
    const res = await postJson(app, "/api/v1/contributions", validCommand);
    const body = await res.json();
    expect(body.version).toBe("1.0.1");
  });

  it("honors versionBump=minor", async () => {
    const { storage, app } = makeApp();
    await storage.putCommand({
      command: {
        slug: "core:tools:my-tool",
        path: "x.md",
        kind: "command",
        description: "v1",
        references: [],
        referencedBy: [],
        body: "v1",
        frontmatter: {},
      },
      version: "2.3.4",
      author: alice,
    });
    const res = await postJson(app, "/api/v1/contributions", {
      ...validCommand,
      versionBump: "minor",
    });
    const body = await res.json();
    expect(body.version).toBe("2.4.0");
  });

  it("accepts a skill bundle with SKILL.md and companion files", async () => {
    const { app } = makeApp();
    const skill: CreateContributionRequest = {
      kind: "skill",
      slug: "my-router",
      frontmatter: {
        name: "my-router",
        description: "Routes intent",
      },
      files: [
        { path: "SKILL.md", content: "# my-router\n\nRoute things.\n" },
        { path: "helper.py", content: "print('hi')\n" },
        { path: "config.json", content: '{"version": 1}' },
      ],
    };
    const res = await postJson(app, "/api/v1/contributions", skill);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe("skill");
  });
});

describe("POST /api/v1/contributions - failure paths", () => {
  it("rejects missing Authorization header with 401", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request(url("/api/v1/contributions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCommand),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON body with 400", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request(url("/api/v1/contributions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev-token",
        },
        body: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects bodies missing required top-level fields with 400", async () => {
    const { app } = makeApp();
    const res = await postJson(app, "/api/v1/contributions", { kind: "command" });
    expect(res.status).toBe(400);
  });

  it("returns 422 with findings on layer-1 validation failure (bad slug)", async () => {
    const { app } = makeApp();
    const res = await postJson(app, "/api/v1/contributions", {
      ...validCommand,
      slug: "BAD-CAPS",
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation_failed");
    expect(body.details.findings.length).toBeGreaterThan(0);
  });

  it("returns 422 on layer-2 violation (path traversal)", async () => {
    const { app } = makeApp();
    const res = await postJson(app, "/api/v1/contributions", {
      ...validCommand,
      kind: "skill",
      slug: "evil",
      frontmatter: { name: "evil", description: "..." },
      files: [
        { path: "SKILL.md", content: "..." },
        { path: "../escape.py", content: "..." },
      ],
    });
    expect(res.status).toBe(422);
  });

  it("returns 403 when a different author tries to overwrite a slug", async () => {
    const { storage } = makeApp();
    // Alice publishes v1
    await storage.putCommand({
      command: {
        slug: "core:tools:my-tool",
        path: "x.md",
        kind: "command",
        description: "v1",
        references: [],
        referencedBy: [],
        body: "v1",
        frontmatter: {},
      },
      version: "1.0.0",
      author: alice,
    });
    // Bob tries to publish v2
    const bobApp = createApp({
      storage,
      writable: true,
      authVerifier: new FixedAuthorVerifier(bob),
    });
    const res = await postJson(bobApp, "/api/v1/contributions", validCommand);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("author_mismatch");
    expect(body.details.ownerAuthorId).toBe("u_alice");
  });
});

describe("GET /api/v1/contributions/:id", () => {
  it("returns the contribution by content-addressable id", async () => {
    const { app } = makeApp();
    const post = await postJson(app, "/api/v1/contributions", validCommand);
    const created = await post.json();
    const get = await app.fetch(
      new Request(
        url(`/api/v1/contributions/${encodeURIComponent(created.id)}`),
      ),
    );
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.slug).toBe("core:tools:my-tool");
    expect(body.version).toBe("1.0.0");
    expect(body.promoted).toBe(false);
  });

  it("returns 404 for unknown id", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request(
        url("/api/v1/contributions/" + encodeURIComponent("command:nope:nope@9.9.9")),
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed id", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request(url("/api/v1/contributions/garbage-no-at-sign")),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/contributions/:id/promote", () => {
  it("promotes a version, makes it visible in /catalog", async () => {
    const { app, storage } = makeApp();
    await postJson(app, "/api/v1/contributions", validCommand);
    // Before promote - command not in /catalog
    const before = await app.fetch(new Request(url("/api/v1/catalog")));
    const beforeBody = await before.json();
    expect(beforeBody.commands).toHaveLength(0);

    // Promote
    const promote = await app.fetch(
      new Request(
        url(
          "/api/v1/contributions/" +
            encodeURIComponent("command:core:tools:my-tool@1.0.0") +
            "/promote",
        ),
        {
          method: "POST",
          headers: { Authorization: "Bearer dev-token" },
        },
      ),
    );
    expect(promote.status).toBe(200);

    // After promote - command appears in /catalog
    const after = await app.fetch(new Request(url("/api/v1/catalog")));
    const afterBody = await after.json();
    expect(afterBody.commands).toHaveLength(1);
    expect(afterBody.commands[0].slug).toBe("core:tools:my-tool");

    // GET on the contribution id now shows promoted=true
    const get = await app.fetch(
      new Request(
        url(
          "/api/v1/contributions/" +
            encodeURIComponent("command:core:tools:my-tool@1.0.0"),
        ),
      ),
    );
    const getBody = await get.json();
    expect(getBody.promoted).toBe(true);
    expect(getBody.status).toBe("promoted");

    // Storage corroborates the same fact
    const cmd = await storage.getCommand("core:tools:my-tool");
    expect(cmd).not.toBeNull();
  });

  it("returns 404 when promoting an unknown version", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request(
        url(
          "/api/v1/contributions/" +
            encodeURIComponent("command:nope:nope@1.0.0") +
            "/promote",
        ),
        {
          method: "POST",
          headers: { Authorization: "Bearer dev-token" },
        },
      ),
    );
    expect(res.status).toBe(404);
  });
});

describe("contribute endpoints not mounted when storage is read-only", () => {
  it("POST /contributions returns 404 when writable=false", async () => {
    const storage = new MemoryCatalogStorage("0.0.0-test");
    const app = createApp({ storage, writable: false });
    const res = await postJson(app, "/api/v1/contributions", validCommand);
    expect(res.status).toBe(404);
  });
});
