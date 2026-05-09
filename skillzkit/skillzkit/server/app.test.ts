import { describe, expect, it, beforeAll } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import {
  FilesystemCatalogStorage,
  findSkillzkitPackageRoot,
} from "../lib/api/storage/fs.js";
import { MemoryCatalogStorage } from "../lib/api/storage/memory.js";

/**
 * The Hono app is exercised via `app.fetch(request)` — the same entry
 * point Bun.serve and Lambda's `handle` adapter use under the hood.
 * No real HTTP server, no port allocation, no flakiness; tests run
 * the same code path production does.
 */

const __filename = fileURLToPath(import.meta.url);
const packageRoot = findSkillzkitPackageRoot(dirname(__filename));

describe("Hono API — read endpoints against fs storage", () => {
  const fs = new FilesystemCatalogStorage(packageRoot);
  const app = createApp({ storage: fs, writable: false });
  const url = (path: string) => new Request(`http://test${path}`);

  it("GET /api/v1/health returns ok + counts + writable=false", async () => {
    const res = await app.fetch(url("/api/v1/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.writable).toBe(false);
    // Counts kind=command only (excludes context + workflows from
    // the commands count for human-readable parity with `skillzkit list`).
    expect(body.itemCounts.commands).toBeGreaterThan(150);
    expect(body.itemCounts.commands).toBeLessThan(220);
  });

  it("GET /api/v1/catalog returns the index without bodies", async () => {
    const res = await app.fetch(url("/api/v1/catalog"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commands.length).toBeGreaterThan(100);
    expect(body.commands[0]).not.toHaveProperty("body");
  });

  it("GET /api/v1/commands?prefix=core:tools: filters by prefix", async () => {
    const res = await app.fetch(url("/api/v1/commands?prefix=core:tools:"));
    const body = await res.json();
    expect(body.commands.length).toBeGreaterThan(0);
    for (const cmd of body.commands) {
      expect(cmd.slug.startsWith("core:tools:")).toBe(true);
    }
  });

  it("GET /api/v1/commands/:slug returns full body for known slug", async () => {
    const res = await app.fetch(
      url("/api/v1/commands/" + encodeURIComponent("core:tools:biome")),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("core:tools:biome");
    expect(body.body.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/commands/:slug returns 404 for unknown slug", async () => {
    const res = await app.fetch(
      url("/api/v1/commands/" + encodeURIComponent("does:not:exist")),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });

  it("GET /api/v1/search?q=biome finds matching commands", async () => {
    const res = await app.fetch(url("/api/v1/search?q=biome"));
    const body = await res.json();
    expect(body.query).toBe("biome");
    expect(body.commands.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/search without `q` returns 400", async () => {
    const res = await app.fetch(url("/api/v1/search"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("validation_failed");
  });

  it("GET /api/v1/skills lists skills", async () => {
    const res = await app.fetch(url("/api/v1/skills"));
    const body = await res.json();
    expect(body.skills.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/workflows?domain=product filters", async () => {
    const res = await app.fetch(url("/api/v1/workflows?domain=product"));
    const body = await res.json();
    for (const w of body.workflows) expect(w.domain).toBe("product");
  });

  it("GET /api/v1/tags aggregates tag counts", async () => {
    const res = await app.fetch(url("/api/v1/tags"));
    const body = await res.json();
    expect(Array.isArray(body.tags)).toBe(true);
    // The real catalog currently has no tags; that's fine — endpoint
    // should still return cleanly with total: 0.
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  it("404 fallback returns ApiError shape for unknown routes", async () => {
    const res = await app.fetch(url("/api/v1/no-such-route"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });
});

describe("Hono API — read endpoints against memory storage", () => {
  // Verifies the app is truly storage-agnostic — same routes against
  // an empty memory store should return empty lists, not crash.
  it("works against empty memory storage", async () => {
    const memory = new MemoryCatalogStorage("0.0.0-test");
    const app = createApp({ storage: memory, writable: true });
    const res = await app.fetch(new Request("http://test/api/v1/health"));
    const body = await res.json();
    expect(body.writable).toBe(true);
    expect(body.itemCounts).toEqual({ commands: 0, skills: 0, workflows: 0 });
  });
});
