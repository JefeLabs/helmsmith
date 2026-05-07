import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import {
  loadReposRegistry,
  loadAllRegistries,
  getAvailableWorkspaces,
  type RegistrySource,
} from "../config/repos-registry.js";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

// Mock store/paths to control expandTilde
vi.mock("../store/paths.js", () => ({
  expandTilde: vi.fn((p: string) => {
    if (p === "~") return "/home/user";
    if (p.startsWith("~/")) return "/home/user/" + p.slice(2);
    return p;
  }),
}));

// Mock node:os homedir
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/user"),
}));

import { readFile, access } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);

// ── Test Fixtures ──────────────────────────────────────────────────────────

const validRegistryYaml = `
workspaces:
  frontend:
    label: Frontend Apps
    repos:
      - name: web-app
        path: /absolute/web-app
        group: web
        tags:
          - react
      - name: mobile-app
        path: /absolute/mobile-app
        group: mobile
  backend:
    label: Backend Services
    repos:
      - name: api-server
        path: /absolute/api-server
        group: api
groups:
  web:
    label: Web Projects
tags:
  react:
    label: React Apps
`;

const minimalRegistryYaml = `
workspaces:
  default:
    repos:
      - name: my-repo
`;

const registryWithTildePaths = `
workspaces:
  dev:
    repos:
      - name: project-a
        path: ~/code/project-a
      - name: project-b
        path: ~/code/project-b
`;

const registryWithRelativePaths = `
workspaces:
  local:
    repos:
      - name: sibling-repo
        path: ../sibling-repo
      - name: child-repo
        path: ./repos/child-repo
`;

const registryNoPathRepos = `
workspaces:
  remote:
    repos:
      - name: cloud-service
        group: cloud
`;

const invalidYaml = `
workspaces:
  broken: [[[not valid yaml
    repos:
      - name: broken
`;

const schemaInvalidYaml = `
not_workspaces:
  - this is wrong
`;

// ── loadReposRegistry ──────────────────────────────────────────────────────

describe("loadReposRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for non-existent file", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const result = await loadReposRegistry("/does/not/exist/repos.yml");

    expect(result).toBeNull();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("parses valid YAML and validates schema", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(validRegistryYaml);

    const result = await loadReposRegistry("/some/dir/repos.yml");

    expect(result).not.toBeNull();
    expect(result!.workspaces).toBeDefined();
    expect(Object.keys(result!.workspaces)).toEqual(["frontend", "backend"]);
    expect(result!.workspaces.frontend.label).toBe("Frontend Apps");
    expect(result!.workspaces.frontend.repos).toHaveLength(2);
    expect(result!.workspaces.frontend.repos[0].name).toBe("web-app");
    expect(result!.workspaces.frontend.repos[0].group).toBe("web");
    expect(result!.workspaces.frontend.repos[0].tags).toEqual(["react"]);
    expect(result!.workspaces.backend.repos).toHaveLength(1);
    expect(result!.groups).toEqual({ web: { label: "Web Projects" } });
    expect(result!.tags).toEqual({ react: { label: "React Apps" } });
  });

  it("applies Zod defaults for optional fields", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(minimalRegistryYaml);

    const result = await loadReposRegistry("/some/dir/repos.yml");

    expect(result).not.toBeNull();
    expect(result!.workspaces.default.repos[0].group).toBe("default");
    expect(result!.workspaces.default.repos[0].tags).toEqual([]);
    expect(result!.groups).toEqual({});
    expect(result!.tags).toEqual({});
  });

  it("throws on invalid YAML", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(invalidYaml);

    await expect(
      loadReposRegistry("/some/dir/repos.yml")
    ).rejects.toThrow("Invalid YAML in /some/dir/repos.yml");
  });

  it("throws on schema validation failure", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(schemaInvalidYaml);

    await expect(
      loadReposRegistry("/some/dir/repos.yml")
    ).rejects.toThrow("Invalid repos.yml format in /some/dir/repos.yml");
  });

  it("resolves tilde in repo paths", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(registryWithTildePaths);

    const result = await loadReposRegistry("/some/dir/repos.yml");

    expect(result).not.toBeNull();
    expect(result!.workspaces.dev.repos[0].path).toBe("/home/user/code/project-a");
    expect(result!.workspaces.dev.repos[1].path).toBe("/home/user/code/project-b");
  });

  it("resolves relative repo paths against registry file directory", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(registryWithRelativePaths);

    const result = await loadReposRegistry("/opt/configs/repos.yml");

    expect(result).not.toBeNull();
    // ../sibling-repo resolved against /opt/configs/ => /opt/sibling-repo
    expect(result!.workspaces.local.repos[0].path).toBe(
      path.resolve("/opt/configs", "../sibling-repo")
    );
    // ./repos/child-repo resolved against /opt/configs/ => /opt/configs/repos/child-repo
    expect(result!.workspaces.local.repos[1].path).toBe(
      path.resolve("/opt/configs", "./repos/child-repo")
    );
  });

  it("leaves absolute repo paths unchanged", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(validRegistryYaml);

    const result = await loadReposRegistry("/some/dir/repos.yml");

    expect(result).not.toBeNull();
    expect(result!.workspaces.frontend.repos[0].path).toBe("/absolute/web-app");
  });

  it("does not modify repos without a path", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(registryNoPathRepos);

    const result = await loadReposRegistry("/some/dir/repos.yml");

    expect(result).not.toBeNull();
    expect(result!.workspaces.remote.repos[0].name).toBe("cloud-service");
    expect(result!.workspaces.remote.repos[0].path).toBeUndefined();
  });

  it("expands tilde in the registry path itself", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(minimalRegistryYaml);

    await loadReposRegistry("~/.agentx/repos.yml");

    expect(mockAccess).toHaveBeenCalledWith("/home/user/.agentx/repos.yml");
    expect(mockReadFile).toHaveBeenCalledWith("/home/user/.agentx/repos.yml", "utf-8");
  });
});

// ── loadAllRegistries ──────────────────────────────────────────────────────

describe("loadAllRegistries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads from global path", async () => {
    // Global exists
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(validRegistryYaml);

    const sources = await loadAllRegistries();

    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("global");
    expect(sources[0].path).toBe("/home/user/.agentx/repos.yml");
    expect(sources[0].registry.workspaces).toBeDefined();
  });

  it("loads from both global and project paths when gitRoot provided", async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(validRegistryYaml);

    const sources = await loadAllRegistries("/projects/my-project");

    expect(sources).toHaveLength(2);
    expect(sources[0].type).toBe("global");
    expect(sources[0].path).toBe("/home/user/.agentx/repos.yml");
    expect(sources[1].type).toBe("project");
    expect(sources[1].path).toBe("/projects/my-project/.agentx/repos.yml");
  });

  it("returns empty array when no registries exist", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const sources = await loadAllRegistries("/projects/my-project");

    expect(sources).toEqual([]);
  });

  it("warns but continues when a registry is invalid", async () => {
    // Global: file exists but has invalid YAML
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(invalidYaml);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sources = await loadAllRegistries();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warning:")
    );
    expect(sources).toEqual([]);

    warnSpy.mockRestore();
  });

  it("returns only project registry when global does not exist", async () => {
    let callCount = 0;
    mockAccess.mockImplementation(async (p) => {
      callCount++;
      const filePath = String(p);
      // Global path does not exist (first call)
      if (filePath.includes("/home/user/.agentx/repos.yml")) {
        throw new Error("ENOENT");
      }
      // Project path exists
      return undefined;
    });
    mockReadFile.mockResolvedValue(minimalRegistryYaml);

    const sources = await loadAllRegistries("/projects/my-project");

    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("project");
    expect(sources[0].path).toBe("/projects/my-project/.agentx/repos.yml");
  });
});

// ── getAvailableWorkspaces ─────────────────────────────────────────────────

describe("getAvailableWorkspaces", () => {
  const globalSource: RegistrySource = {
    type: "global",
    path: "/home/user/.agentx/repos.yml",
    registry: {
      workspaces: {
        frontend: {
          label: "Frontend Apps",
          repos: [
            { name: "web-app", path: "/code/web-app", group: "web", tags: [] },
          ],
        },
        backend: {
          label: "Backend Services",
          repos: [
            { name: "api", path: "/code/api", group: "api", tags: [] },
          ],
        },
      },
      groups: {},
      tags: {},
    },
  };

  const projectSource: RegistrySource = {
    type: "project",
    path: "/projects/foo/.agentx/repos.yml",
    registry: {
      workspaces: {
        frontend: {
          label: "Project Frontend",
          repos: [
            { name: "project-ui", path: "/projects/foo/ui", group: "web", tags: [] },
          ],
        },
        devops: {
          repos: [
            { name: "infra", path: "/projects/foo/infra", group: "ops", tags: [] },
          ],
        },
      },
      groups: {},
      tags: {},
    },
  };

  it("returns empty array for empty registries", () => {
    const result = getAvailableWorkspaces([]);

    expect(result).toEqual([]);
  });

  it("flattens workspaces from single source", () => {
    const result = getAvailableWorkspaces([globalSource]);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("frontend");
    expect(result[0].label).toBe("Frontend Apps");
    expect(result[0].repos).toHaveLength(1);
    expect(result[0].repos[0].name).toBe("web-app");
    expect(result[0].source).toBe(globalSource);
    expect(result[1].name).toBe("backend");
    expect(result[1].source).toBe(globalSource);
  });

  it("flattens workspaces from multiple sources", () => {
    const result = getAvailableWorkspaces([globalSource, projectSource]);

    expect(result).toHaveLength(4);
    // Global workspaces first
    expect(result[0].name).toBe("frontend");
    expect(result[0].source.type).toBe("global");
    expect(result[1].name).toBe("backend");
    expect(result[1].source.type).toBe("global");
    // Then project workspaces
    expect(result[2].name).toBe("frontend");
    expect(result[2].source.type).toBe("project");
    expect(result[3].name).toBe("devops");
    expect(result[3].source.type).toBe("project");
  });

  it("keeps same-name workspaces from different sources separate", () => {
    const result = getAvailableWorkspaces([globalSource, projectSource]);

    const frontendWorkspaces = result.filter((w) => w.name === "frontend");
    expect(frontendWorkspaces).toHaveLength(2);

    expect(frontendWorkspaces[0].label).toBe("Frontend Apps");
    expect(frontendWorkspaces[0].source.type).toBe("global");
    expect(frontendWorkspaces[0].repos[0].name).toBe("web-app");

    expect(frontendWorkspaces[1].label).toBe("Project Frontend");
    expect(frontendWorkspaces[1].source.type).toBe("project");
    expect(frontendWorkspaces[1].repos[0].name).toBe("project-ui");
  });

  it("each workspace includes its source reference", () => {
    const result = getAvailableWorkspaces([globalSource, projectSource]);

    for (const workspace of result) {
      expect(workspace.source).toBeDefined();
      expect(workspace.source.type).toMatch(/^(global|project)$/);
      expect(workspace.source.path).toBeDefined();
      expect(workspace.source.registry).toBeDefined();
    }

    // Verify source references are the exact objects
    const globalWorkspaces = result.filter((w) => w.source.type === "global");
    for (const ws of globalWorkspaces) {
      expect(ws.source).toBe(globalSource);
    }

    const projectWorkspaces = result.filter((w) => w.source.type === "project");
    for (const ws of projectWorkspaces) {
      expect(ws.source).toBe(projectSource);
    }
  });
});
