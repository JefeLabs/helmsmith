import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearCache,
  getCachedTicket,
  getCachePath,
  readCache,
  setCachedTicket,
  writeCache,
} from "./cache.js";

describe("validation cache", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pritty-cache-test-"));
    process.env.PRITTY_HOME = tmp;
  });

  afterEach(() => {
    delete process.env.PRITTY_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns an empty cache when no file exists", () => {
    const cache = readCache();
    expect(cache.tickets).toEqual({});
  });

  it("getCachedTicket returns null for missing entries", () => {
    expect(getCachedTicket("PROJ-1", "jira-rest")).toBeNull();
  });

  it("setCachedTicket writes and getCachedTicket reads back", () => {
    setCachedTicket("PROJ-1", "jira-rest", {
      exists: true,
      title: "Add SSO support",
      url: "https://x/PROJ-1",
    });
    const entry = getCachedTicket("PROJ-1", "jira-rest");
    expect(entry?.exists).toBe(true);
    expect(entry?.title).toBe("Add SSO support");
    expect(entry?.system).toBe("jira-rest");
    expect(entry?.validatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("scopes cache keys by system (same ticket key, different system)", () => {
    setCachedTicket("PROJ-1", "jira-rest", { exists: true });
    setCachedTicket("PROJ-1", "linear", { exists: false });
    expect(getCachedTicket("PROJ-1", "jira-rest")?.exists).toBe(true);
    expect(getCachedTicket("PROJ-1", "linear")?.exists).toBe(false);
  });

  it("clearCache removes the file", () => {
    setCachedTicket("PROJ-1", "jira-rest", { exists: true });
    expect(getCachedTicket("PROJ-1", "jira-rest")).not.toBeNull();
    clearCache();
    expect(getCachedTicket("PROJ-1", "jira-rest")).toBeNull();
  });

  it("clearCache is idempotent on missing file", () => {
    expect(() => clearCache()).not.toThrow();
    expect(() => clearCache()).not.toThrow();
  });

  it("getCachePath honors PRITTY_HOME", () => {
    expect(getCachePath()).toBe(join(tmp, "cache.json"));
  });

  it("survives a corrupted cache file", () => {
    writeCache({ version: 1, tickets: {} });
    // Manually corrupt
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(getCachePath(), "::not yaml or json::");
    expect(readCache().tickets).toEqual({});
  });
});
