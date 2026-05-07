import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  getRegisteredTool,
  isRegistered,
  listRegisteredTools,
  loadRegistry,
  registerTool,
  saveRegistry,
  unregisterTool,
} from "./registry.js";

/**
 * Tests use AGENTX_TOOLZ_DIR to redirect the registry path to a tmp
 * dir per test. Avoids polluting the developer's real ~/.agentx/toolz/
 * and lets each test see a clean state.
 */

describe("registry CRUD", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "toolz-test-"));
    process.env.AGENTX_TOOLZ_DIR = tmp;
  });

  afterEach(() => {
    delete process.env.AGENTX_TOOLZ_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads an empty registry when no file exists", () => {
    const registry = loadRegistry();
    expect(registry.version).toBe(1);
    expect(registry.tools).toEqual({});
  });

  it("registers a tool and reads it back", () => {
    registerTool("git", {
      version: "2.43.0",
      path: "/usr/bin/git",
      installed_via: "brew",
      installed_at: "2026-05-07T12:00:00Z",
    });
    const entry = getRegisteredTool("git");
    expect(entry?.version).toBe("2.43.0");
    expect(entry?.path).toBe("/usr/bin/git");
    expect(entry?.installed_via).toBe("brew");
    expect(entry?.registered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("isRegistered returns true after registration, false after unregister", () => {
    registerTool("jq", {
      version: "1.7",
      path: "/opt/homebrew/bin/jq",
      installed_via: "brew",
      installed_at: null,
    });
    expect(isRegistered("jq")).toBe(true);
    expect(isRegistered("missing")).toBe(false);

    const removed = unregisterTool("jq");
    expect(removed).toBe(true);
    expect(isRegistered("jq")).toBe(false);
  });

  it("unregister returns false for an unknown tool", () => {
    const removed = unregisterTool("never-registered");
    expect(removed).toBe(false);
  });

  it("listRegisteredTools returns alphabetically-sorted entries", () => {
    registerTool("zoo", {
      version: "1.0",
      path: "/x/zoo",
      installed_via: "brew",
      installed_at: null,
    });
    registerTool("apple", {
      version: "2.0",
      path: "/x/apple",
      installed_via: "brew",
      installed_at: null,
    });
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toEqual(["apple", "zoo"]);
  });

  it("survives a corrupted YAML file (returns empty registry)", () => {
    // Write garbage to the registry path
    writeFileSync(join(tmp, "registry.yaml"), "::not valid yaml::: { ", "utf8");
    const registry = loadRegistry();
    expect(registry.tools).toEqual({});
  });

  it("saveRegistry writes parseable YAML with a fresh updated_at", () => {
    const before = new Date().toISOString();
    saveRegistry({
      version: 1,
      updated_at: "old",
      tools: {
        git: {
          version: "2.43.0",
          path: "/usr/bin/git",
          installed_via: "brew",
          installed_at: null,
          registered_at: "2026-05-07T00:00:00Z",
        },
      },
    });
    const raw = readFileSync(join(tmp, "registry.yaml"), "utf8");
    const parsed = parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.tools.git.path).toBe("/usr/bin/git");
    expect(parsed.updated_at >= before).toBe(true);
  });
});
