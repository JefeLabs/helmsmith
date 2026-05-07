import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { installSlugs } from "./install.js";
import { loadCatalog } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

describe("installSlugs", () => {
  let target: string;

  beforeEach(() => {
    target = mkdtempSync(join(tmpdir(), "skillz-test-"));
  });

  afterEach(() => {
    rmSync(target, { recursive: true, force: true });
  });

  it("copies the requested slug's file", () => {
    const result = installSlugs(
      new Set(["core:tools:pixelmatch"]),
      loadCatalog(),
      packageRoot,
      target,
    );
    expect(result.installedFiles).toBeGreaterThan(0);
    expect(
      existsSync(
        join(target, ".claude/commands/core/tools/pixelmatch.md"),
      ),
    ).toBe(true);
  });

  it("always installs infra files (audit, workflows, _context)", () => {
    installSlugs(
      new Set(["core:tools:pixelmatch"]),
      loadCatalog(),
      packageRoot,
      target,
    );
    expect(
      existsSync(join(target, ".claude/commands/_context.md")),
    ).toBe(true);
    expect(
      existsSync(
        join(target, ".claude/commands/core/audit/audit.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(target, ".claude/commands/core/workflows/manage.md"),
      ),
    ).toBe(true);
  });

  it("always installs all skills regardless of the requested set", () => {
    installSlugs(
      new Set(["core:tools:pixelmatch"]),
      loadCatalog(),
      packageRoot,
      target,
    );
    const catalog = loadCatalog();
    for (const skill of catalog.skills) {
      expect(
        existsSync(join(target, ".claude/skills", skill.path)),
      ).toBe(true);
    }
  });

  it("writes runtime manifests for picked tools and integrations", () => {
    installSlugs(
      new Set(["core:tools:pixelmatch", "core:integrations:github"]),
      loadCatalog(),
      packageRoot,
      target,
    );
    const toolsManifest = JSON.parse(
      readFileSync(join(target, "product/.pencil-tools.json"), "utf8"),
    );
    expect(toolsManifest.tools.pixelmatch).toBeDefined();
    expect(toolsManifest.tools.pixelmatch.interfaces).toContain("cli");

    const integrationsManifest = JSON.parse(
      readFileSync(
        join(target, "product/.pencil-integrations.json"),
        "utf8",
      ),
    );
    expect(integrationsManifest.integrations.github).toBeDefined();
  });

  it("skips files that already exist when force is not set", () => {
    installSlugs(
      new Set(["core:tools:pixelmatch"]),
      loadCatalog(),
      packageRoot,
      target,
    );
    const second = installSlugs(
      new Set(["core:tools:pixelmatch"]),
      loadCatalog(),
      packageRoot,
      target,
    );
    expect(second.installedFiles).toBe(0);
    expect(second.skippedExisting).toBeGreaterThan(0);
  });

  it("overwrites existing files when force is true", () => {
    installSlugs(
      new Set(["core:tools:pixelmatch"]),
      loadCatalog(),
      packageRoot,
      target,
    );
    const second = installSlugs(
      new Set(["core:tools:pixelmatch"]),
      loadCatalog(),
      packageRoot,
      target,
      { force: true },
    );
    expect(second.installedFiles).toBeGreaterThan(0);
    expect(second.skippedExisting).toBe(0);
  });
});
