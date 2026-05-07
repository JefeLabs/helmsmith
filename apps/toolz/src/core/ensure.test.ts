import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTool, ensureTools } from "./ensure.js";
import { isRegistered, registerTool } from "../config/registry.js";

/**
 * Tests use AGENTX_TOOLZ_DIR to redirect the registry to a tmp dir.
 * They probe `node` (always present where vitest runs) for the
 * happy-path cases and a definitely-absent name for the missing-tool
 * cases. autoInstall=true is NOT exercised here — that would require a
 * real package manager and is integration-test territory.
 */

describe("ensureTool", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "toolz-ensure-test-"));
    process.env.AGENTX_TOOLZ_DIR = tmp;
  });

  afterEach(() => {
    delete process.env.AGENTX_TOOLZ_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("finds an on-PATH tool, registers it, returns source=found-on-path", async () => {
    expect(isRegistered("node")).toBe(false);
    const status = await ensureTool("node");
    expect(status.installed).toBe(true);
    expect(status.path).toBeTruthy();
    expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(status.source).toBe("found-on-path");
    expect(isRegistered("node")).toBe(true);
  });

  it("hits the registry fast path on second call", async () => {
    await ensureTool("node");
    const second = await ensureTool("node");
    expect(second.source).toBe("registry");
    expect(second.installed).toBe(true);
  });

  it("returns missing for a definitely-absent tool when autoInstall=false", async () => {
    const status = await ensureTool("definitely-not-a-real-binary-xyz123");
    expect(status.installed).toBe(false);
    expect(status.source).toBe("missing");
    expect(status.versionTooLow).toBe(false);
    expect(status.error).toBeUndefined();
  });

  it("flags versionTooLow when minVersion exceeds installed version", async () => {
    // Pretend node 999 is required — your installed node is way below.
    const status = await ensureTool("node", { minVersion: "999.0.0" });
    expect(status.installed).toBe(true);
    expect(status.versionTooLow).toBe(true);
  });

  it("does not flag versionTooLow when minVersion is satisfied", async () => {
    const status = await ensureTool("node", { minVersion: "10.0.0" });
    expect(status.installed).toBe(true);
    expect(status.versionTooLow).toBe(false);
  });

  it("registry fast path returns source=registry without re-probing", async () => {
    // Pre-populate registry with bogus path; if ensureTool re-probed,
    // it'd notice the path is stale. The fast path trusts the registry
    // until `toolz doctor` cleans it up.
    registerTool("fake-tool", {
      version: "1.0.0",
      path: "/fake/path/fake-tool",
      installed_via: null,
      installed_at: null,
    });
    const status = await ensureTool("fake-tool");
    expect(status.source).toBe("registry");
    expect(status.installed).toBe(true);
    expect(status.path).toBe("/fake/path/fake-tool");
  });
});

describe("ensureTools", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "toolz-ensure-tools-test-"));
    process.env.AGENTX_TOOLZ_DIR = tmp;
  });

  afterEach(() => {
    delete process.env.AGENTX_TOOLZ_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns one ToolStatus per requested tool, in input order", async () => {
    const statuses = await ensureTools([
      "node",
      "definitely-not-a-real-binary-xyz123",
    ]);
    expect(statuses).toHaveLength(2);
    expect(statuses[0].name).toBe("node");
    expect(statuses[0].installed).toBe(true);
    expect(statuses[1].name).toBe("definitely-not-a-real-binary-xyz123");
    expect(statuses[1].installed).toBe(false);
  });

  it("accepts a per-tool options object", async () => {
    const statuses = await ensureTools({
      node: { minVersion: "999.0.0" }, // intentionally fail
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0].installed).toBe(true);
    expect(statuses[0].versionTooLow).toBe(true);
  });
});
