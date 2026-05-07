import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDoctor } from "./doctor.js";
import { registerTool } from "../config/registry.js";

describe("runDoctor", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "toolz-doctor-test-"));
    process.env.AGENTX_TOOLZ_DIR = tmp;
  });

  afterEach(() => {
    delete process.env.AGENTX_TOOLZ_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns no findings for an empty registry", async () => {
    const findings = await runDoctor();
    expect(findings).toEqual([]);
  });

  it("flags path-missing for a tool whose registered path no longer exists", async () => {
    registerTool("ghost", {
      version: "1.0.0",
      path: "/nonexistent/path/ghost",
      installed_via: null,
      installed_at: null,
    });
    const findings = await runDoctor();
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("path-missing");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].tool).toBe("ghost");
    expect(findings[0].fix).toMatch(/deregister|register/);
  });

  it("flags path-drift when which resolves elsewhere", async () => {
    // Register node at a definitely-different path than what `which`
    // returns. The path must exist (otherwise path-missing fires
    // first and we short-circuit), so we register the node binary
    // *itself* with /usr/bin as the directory — a path that exists
    // but isn't where node actually is.
    registerTool("node", {
      version: "22.20.0",
      path: "/usr/bin", // exists as a directory; the binary isn't here
      installed_via: null,
      installed_at: null,
    });
    const findings = await runDoctor();
    const drift = findings.find((f) => f.code === "path-drift");
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("warning");
    expect(drift?.tool).toBe("node");
  });

  it("flags version-drift when re-probed version differs", async () => {
    registerTool("node", {
      version: "1.0.0-stale", // wildly wrong; current is 22.x
      path: process.execPath, // valid path so path checks pass
      installed_via: null,
      installed_at: null,
    });
    const findings = await runDoctor();
    const drift = findings.find((f) => f.code === "version-drift");
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("info");
  });

  it("does not flag when registry matches reality", async () => {
    // Register node with the actual path and the real version. We
    // don't know the exact version at compile-time, so we look it up.
    const { checkTool } = await import("./tool-checker.js");
    const probed = await checkTool("node");
    if (!probed.installed) return; // node missing — skip
    registerTool("node", {
      version: probed.version,
      path: probed.path!,
      installed_via: null,
      installed_at: null,
    });
    const findings = await runDoctor();
    const nodeFindings = findings.filter((f) => f.tool === "node");
    expect(nodeFindings).toEqual([]);
  });
});
