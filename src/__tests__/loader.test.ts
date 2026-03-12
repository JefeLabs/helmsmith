import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { loadConfig } from "../config/loader.js";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

// Mock store/paths to control getConfigPath and expandTilde
vi.mock("../store/paths.js", () => ({
  getConfigPath: vi.fn(() => "/home/user/.agentx/gitradar/config.yml"),
  expandTilde: vi.fn((p: string) => {
    if (p === "~") return "/home/user";
    if (p.startsWith("~/")) return "/home/user/" + p.slice(2);
    return p;
  }),
}));

import { readFile, access } from "node:fs/promises";
import { getConfigPath } from "../store/paths.js";

const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);

const validYaml = `
repos:
  - path: /absolute/repo1
    name: repo1
    group: web
orgs:
  - name: TeamA
    type: core
    teams:
      - name: Platform
        tag: infrastructure
        members:
          - name: Alice
            email: alice@example.com
`;

const validYamlWithTilde = `
repos:
  - path: ~/code/frontend
    name: frontend
    group: web
orgs:
  - name: TeamA
    type: core
    teams:
      - name: Platform
        members:
          - name: Alice
            email: alice@example.com
`;

const validYamlWithRelativePath = `
repos:
  - path: ../my-repo
    name: my-repo
    group: backend
orgs:
  - name: TeamA
    type: core
    teams:
      - name: Platform
        members:
          - name: Alice
            email: alice@example.com
`;

const invalidYaml = `
repos:
  - path: [[[invalid yaml
  name: broken
    indentation: wrong
`;

const schemaInvalidYaml = `
repos:
  - path: /some/path
orgs:
  - name: TeamA
    type: invalid_type
    teams: []
`;

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Valid config ────────────────────────────────────────────────────────────

  describe("valid configuration", () => {
    it("loads and parses a valid YAML config", async () => {
      mockReadFile.mockResolvedValue(validYaml);
      mockAccess.mockResolvedValue(undefined);

      const config = await loadConfig("/path/to/config.yml");

      expect(config.repos).toHaveLength(1);
      expect(config.repos[0].name).toBe("repo1");
      expect(config.repos[0].group).toBe("web");
      expect(config.orgs).toHaveLength(1);
      expect(config.orgs[0].name).toBe("TeamA");
      expect(config.orgs[0].type).toBe("core");
    });

    it("uses default config path when none provided", async () => {
      mockReadFile.mockResolvedValue(validYaml);
      mockAccess.mockResolvedValue(undefined);

      await loadConfig();

      expect(mockReadFile).toHaveBeenCalledWith(
        "/home/user/.agentx/gitradar/config.yml",
        "utf-8"
      );
    });

    it("applies Zod defaults for optional fields", async () => {
      const minimalYaml = `
repos:
  - path: /repo
orgs:
  - name: Org
    type: core
    teams:
      - name: Team
        members:
          - name: Bob
`;
      mockReadFile.mockResolvedValue(minimalYaml);
      mockAccess.mockResolvedValue(undefined);

      const config = await loadConfig("/some/config.yml");

      expect(config.repos[0].group).toBe("default");
      expect(config.settings.weeks_back).toBe(12);
      expect(config.settings.staleness_minutes).toBe(60);
      expect(config.groups).toEqual({});
      expect(config.tags).toEqual({});
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws 'Config file not found' for missing file", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      await expect(loadConfig("/nonexistent/config.yml")).rejects.toThrow(
        "Config file not found at /nonexistent/config.yml"
      );
    });

    it("throws 'Invalid YAML' for malformed YAML", async () => {
      mockReadFile.mockResolvedValue(invalidYaml);

      await expect(loadConfig("/path/to/bad.yml")).rejects.toThrow(
        "Invalid YAML"
      );
    });

    it("throws descriptive error for schema violations", async () => {
      mockReadFile.mockResolvedValue(schemaInvalidYaml);

      await expect(loadConfig("/path/to/invalid.yml")).rejects.toThrow(
        "Config validation failed:"
      );
    });
  });

  // ── Path resolution ────────────────────────────────────────────────────────

  describe("path resolution", () => {
    it("expands ~ in repo paths", async () => {
      mockReadFile.mockResolvedValue(validYamlWithTilde);
      mockAccess.mockResolvedValue(undefined);

      const config = await loadConfig("/some/dir/config.yml");

      expect(config.repos[0].path).toBe("/home/user/code/frontend");
    });

    it("resolves relative repo paths against config file directory", async () => {
      mockReadFile.mockResolvedValue(validYamlWithRelativePath);
      mockAccess.mockResolvedValue(undefined);

      const config = await loadConfig("/opt/configs/config.yml");

      // ../my-repo resolved against /opt/configs/ => /opt/my-repo
      expect(config.repos[0].path).toBe(
        path.resolve("/opt/configs", "../my-repo")
      );
    });

    it("leaves absolute repo paths unchanged", async () => {
      mockReadFile.mockResolvedValue(validYaml);
      mockAccess.mockResolvedValue(undefined);

      const config = await loadConfig("/some/dir/config.yml");

      expect(config.repos[0].path).toBe("/absolute/repo1");
    });
  });

  // ── Missing repo warning ──────────────────────────────────────────────────

  describe("missing repo path warning", () => {
    it("warns when a repo path does not exist on disk", async () => {
      mockReadFile.mockResolvedValue(validYaml);
      mockAccess.mockRejectedValue(new Error("ENOENT"));

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const config = await loadConfig("/some/dir/config.yml");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("repo path does not exist")
      );
      // Should NOT throw — config should still be returned
      expect(config.repos).toHaveLength(1);

      warnSpy.mockRestore();
    });

    it("does not warn when repo path exists", async () => {
      mockReadFile.mockResolvedValue(validYaml);
      mockAccess.mockResolvedValue(undefined);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await loadConfig("/some/dir/config.yml");

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
