import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CATALOG,
  catalogToolNames,
  resolvePackageName,
} from "./tool-resolver.js";

describe("resolvePackageName", () => {
  it("returns the brew-specific name for git", () => {
    const result = resolvePackageName("git", "brew");
    expect(result).toEqual({
      packageName: "git",
      entry: BUILT_IN_CATALOG.git,
    });
  });

  it("handles cross-manager name divergence (fd → fd-find on apt)", () => {
    const brew = resolvePackageName("fd", "brew");
    const apt = resolvePackageName("fd", "apt");
    expect(brew?.packageName).toBe("fd");
    expect(apt?.packageName).toBe("fd-find");
  });

  it("returns the winget vendor-prefixed ID for github CLI", () => {
    const result = resolvePackageName("gh", "winget");
    expect(result?.packageName).toBe("GitHub.cli");
  });

  it("returns null for an unknown tool", () => {
    const result = resolvePackageName("not-a-real-tool", "brew");
    expect(result).toBeNull();
  });

  it("returns null when the tool is in the catalog but the manager isn't covered", () => {
    // None of our entries currently have dnf entries, so dnf should
    // miss for every catalog tool.
    const result = resolvePackageName("git", "dnf");
    expect(result).toBeNull();
  });
});

describe("catalogToolNames", () => {
  it("returns sorted names from the catalog", () => {
    const names = catalogToolNames();
    expect(names.length).toBeGreaterThan(0);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("includes the well-known tools", () => {
    const names = catalogToolNames();
    expect(names).toContain("git");
    expect(names).toContain("gh");
    expect(names).toContain("jq");
  });
});
