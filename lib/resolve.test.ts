import { describe, expect, it } from "vitest";
import { expandGroupIds, resolveInstallPlan } from "./resolve.js";
import { getCommands } from "./index.js";

describe("expandGroupIds", () => {
  it("expands a bare persona to all commands in that namespace", () => {
    const expanded = expandGroupIds(["engineer"]);
    expect(expanded.length).toBeGreaterThan(0);
    expect(expanded.every((s) => s.startsWith("engineer:"))).toBe(true);
  });

  it("expands a wildcard prefix to commands under that namespace", () => {
    const expanded = expandGroupIds(["core:tools:*"]);
    expect(expanded.length).toBeGreaterThan(0);
    expect(expanded.every((s) => s.startsWith("core:tools:"))).toBe(true);
  });

  it("excludes context-kind entries from group expansion", () => {
    const expanded = expandGroupIds(["product"]);
    const ctxCount = getCommands().filter(
      (c) => c.slug.startsWith("product:") && c.kind === "context",
    ).length;
    expect(ctxCount).toBeGreaterThan(0); // sanity: there ARE context entries
    // expanded set must NOT include any of them
    const expandedSet = new Set(expanded);
    for (const c of getCommands()) {
      if (c.slug.startsWith("product:") && c.kind === "context") {
        expect(expandedSet.has(c.slug)).toBe(false);
      }
    }
  });

  it("passes through exact slugs unchanged", () => {
    const expanded = expandGroupIds(["core:tools:npm", "core:tools:biome"]);
    expect(expanded).toEqual(
      expect.arrayContaining(["core:tools:npm", "core:tools:biome"]),
    );
    expect(expanded).toHaveLength(2);
  });

  it("dedupes when group expansion overlaps with explicit slugs", () => {
    const expanded = expandGroupIds(["core:tools:*", "core:tools:npm"]);
    const npmCount = expanded.filter((s) => s === "core:tools:npm").length;
    expect(npmCount).toBe(1);
  });
});

describe("resolveInstallPlan", () => {
  it("returns just the requested item for a command seed (no cascade)", () => {
    const { plan, missing } = resolveInstallPlan(["core:tools:pixelmatch"]);
    expect(missing).toHaveLength(0);
    expect(plan).toHaveLength(1);
    expect(plan[0].slug).toBe("core:tools:pixelmatch");
    expect(plan[0].kind).toBe("command");
  });

  it("cascades a workflow seed but skips core:* refs", () => {
    const { plan, missing } = resolveInstallPlan(["product:greenfield"]);
    expect(missing).toHaveLength(0);
    expect(plan.length).toBeGreaterThan(1);
    // No core:* slugs should appear (workflow cascade skips them)
    expect(plan.every((p) => !p.slug.startsWith("core:"))).toBe(true);
    // Seed itself appears
    expect(plan.some((p) => p.slug === "product:greenfield")).toBe(true);
  });

  it("cascades a skill seed unconditionally including core:* refs", () => {
    const { plan, missing } = resolveInstallPlan(["skillzkit-product-router"]);
    expect(missing).toHaveLength(0);
    expect(plan.length).toBeGreaterThan(1);
    // Skills' refs include core:* paths — they should appear in the plan
    expect(plan.some((p) => p.slug.startsWith("core:"))).toBe(true);
  });

  it("reports unresolved slugs in missing[] without throwing", () => {
    const { plan, missing } = resolveInstallPlan(["nope:does:not:exist"]);
    expect(missing).toContain("nope:does:not:exist");
    expect(plan).toHaveLength(0);
  });

  it("attributes transitive deps via requestedBy", () => {
    const { plan } = resolveInstallPlan(["product:greenfield"]);
    const seed = plan.find((p) => p.slug === "product:greenfield");
    expect(seed?.requestedBy).toBeUndefined();
    const transitive = plan.find((p) => p.slug !== "product:greenfield");
    expect(transitive?.requestedBy).toBe("product:greenfield");
  });
});
