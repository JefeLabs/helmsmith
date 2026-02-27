import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import yaml from "js-yaml";
import type { RegistrySource, LoadedWorkspace } from "../config/repos-registry.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../config/git-root.js", () => ({
  detectGitRoot: vi.fn(),
}));

vi.mock("../config/repos-registry.js", () => ({
  loadAllRegistries: vi.fn(),
  getAvailableWorkspaces: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

import { detectGitRoot } from "../config/git-root.js";
import { loadAllRegistries, getAvailableWorkspaces } from "../config/repos-registry.js";
import { select } from "@inquirer/prompts";
import { exportWorkspace } from "../commands/export.js";

const mockDetectGitRoot = vi.mocked(detectGitRoot);
const mockLoadAllRegistries = vi.mocked(loadAllRegistries);
const mockGetAvailableWorkspaces = vi.mocked(getAvailableWorkspaces);
const mockSelect = vi.mocked(select);

// ── Test Fixtures ────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<RegistrySource> = {}): RegistrySource {
  return {
    type: "global",
    path: "/home/user/.agentx/repos.yml",
    registry: {
      workspaces: {},
      groups: {},
      tags: {},
    },
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<LoadedWorkspace> = {}): LoadedWorkspace {
  const source = overrides.source ?? makeSource();
  return {
    name: "test-workspace",
    repos: [],
    source,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("exportWorkspace", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;

    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockDetectGitRoot.mockResolvedValue("/some/git/root");
    mockLoadAllRegistries.mockResolvedValue([]);
    mockGetAvailableWorkspaces.mockReturnValue([]);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ── 1. Strips paths from output ─────────────────────────────────────────

  it("strips paths from exported repos", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          myws: {
            repos: [
              { name: "repo-a", path: "/absolute/path/to/repo-a", group: "web", tags: ["react"] },
            ],
          },
        },
        groups: {},
        tags: {},
      },
    });

    const workspace = makeWorkspace({
      name: "myws",
      repos: [
        { name: "repo-a", path: "/absolute/path/to/repo-a", group: "web", tags: ["react"] },
      ],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([workspace]);

    await exportWorkspace();

    expect(stdoutSpy).toHaveBeenCalled();
    const output = (stdoutSpy.mock.calls[0][0] as string);
    const parsed = yaml.load(output) as Record<string, unknown>;
    const workspaces = parsed.workspaces as Record<string, { repos: Record<string, unknown>[] }>;
    const repos = workspaces.myws.repos;

    expect(repos).toHaveLength(1);
    expect(repos[0]).not.toHaveProperty("path");
    expect(repos[0].name).toBe("repo-a");
    expect(repos[0].group).toBe("web");
    expect(repos[0].tags).toEqual(["react"]);
  });

  // ── 2. Produces valid YAML ──────────────────────────────────────────────

  it("produces valid YAML output", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          demo: {
            label: "Demo",
            repos: [
              { name: "app", path: "/code/app", group: "frontend", tags: ["ts"] },
            ],
          },
        },
        groups: { frontend: { label: "Frontend" } },
        tags: { ts: { label: "TypeScript" } },
      },
    });

    const workspace = makeWorkspace({
      name: "demo",
      label: "Demo",
      repos: [
        { name: "app", path: "/code/app", group: "frontend", tags: ["ts"] },
      ],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([workspace]);

    await exportWorkspace();

    expect(stdoutSpy).toHaveBeenCalled();
    const output = (stdoutSpy.mock.calls[0][0] as string);

    // Should not throw
    expect(() => yaml.load(output)).not.toThrow();

    const parsed = yaml.load(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty("workspaces");
  });

  // ── 3. Includes groups and tags from source registry ────────────────────

  it("includes groups and tags from source registry", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          myws: {
            repos: [{ name: "repo-a", group: "web", tags: ["react"] }],
          },
        },
        groups: { web: { label: "Web Projects" }, api: { label: "API Services" } },
        tags: { react: { label: "React Apps" }, node: { label: "Node.js" } },
      },
    });

    const workspace = makeWorkspace({
      name: "myws",
      repos: [{ name: "repo-a", group: "web", tags: ["react"] }],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([workspace]);

    await exportWorkspace();

    const output = (stdoutSpy.mock.calls[0][0] as string);
    const parsed = yaml.load(output) as Record<string, unknown>;

    expect(parsed.groups).toEqual({
      web: { label: "Web Projects" },
      api: { label: "API Services" },
    });
    expect(parsed.tags).toEqual({
      react: { label: "React Apps" },
      node: { label: "Node.js" },
    });
  });

  // ── 4. Single workspace auto-selects ────────────────────────────────────

  it("auto-selects when only one workspace exists (no prompt)", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          only: { repos: [{ name: "solo", group: "default", tags: [] }] },
        },
        groups: {},
        tags: {},
      },
    });

    const workspace = makeWorkspace({
      name: "only",
      repos: [{ name: "solo", group: "default", tags: [] }],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([workspace]);

    await exportWorkspace();

    expect(mockSelect).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalled();
  });

  // ── 5. Multiple workspaces prompts for selection ────────────────────────

  it("prompts for selection when multiple workspaces exist", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          ws1: { repos: [{ name: "r1", group: "default", tags: [] }] },
          ws2: { repos: [{ name: "r2", group: "default", tags: [] }] },
        },
        groups: {},
        tags: {},
      },
    });

    const ws1 = makeWorkspace({
      name: "ws1",
      repos: [{ name: "r1", group: "default", tags: [] }],
      source,
    });

    const ws2 = makeWorkspace({
      name: "ws2",
      repos: [{ name: "r2", group: "default", tags: [] }],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([ws1, ws2]);
    mockSelect.mockResolvedValue(ws1);

    await exportWorkspace();

    expect(mockSelect).toHaveBeenCalledWith({
      message: "Select workspace to export:",
      choices: expect.arrayContaining([
        expect.objectContaining({ value: ws1 }),
        expect.objectContaining({ value: ws2 }),
      ]),
    });
    expect(stdoutSpy).toHaveBeenCalled();
  });

  // ── 6. Shows error when no workspaces found ─────────────────────────────

  it("shows error when no workspaces found", async () => {
    mockGetAvailableWorkspaces.mockReturnValue([]);

    await exportWorkspace();

    expect(stderrSpy).toHaveBeenCalledWith(
      "No workspaces found. Create ~/.agentx/repos.yml first."
    );
    expect(process.exitCode).toBe(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  // ── 7. Omits default group ──────────────────────────────────────────────

  it("omits group when repo group is 'default'", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          myws: {
            repos: [{ name: "repo-default", group: "default", tags: ["ts"] }],
          },
        },
        groups: {},
        tags: {},
      },
    });

    const workspace = makeWorkspace({
      name: "myws",
      repos: [{ name: "repo-default", group: "default", tags: ["ts"] }],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([workspace]);

    await exportWorkspace();

    const output = (stdoutSpy.mock.calls[0][0] as string);
    const parsed = yaml.load(output) as Record<string, unknown>;
    const workspaces = parsed.workspaces as Record<string, { repos: Record<string, unknown>[] }>;
    const repos = workspaces.myws.repos;

    expect(repos).toHaveLength(1);
    expect(repos[0]).not.toHaveProperty("group");
    expect(repos[0].name).toBe("repo-default");
  });

  // ── 8. Omits empty tags ─────────────────────────────────────────────────

  it("omits tags when repo has empty tags array", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          myws: {
            repos: [{ name: "repo-notags", group: "web", tags: [] }],
          },
        },
        groups: {},
        tags: {},
      },
    });

    const workspace = makeWorkspace({
      name: "myws",
      repos: [{ name: "repo-notags", group: "web", tags: [] }],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([workspace]);

    await exportWorkspace();

    const output = (stdoutSpy.mock.calls[0][0] as string);
    const parsed = yaml.load(output) as Record<string, unknown>;
    const workspaces = parsed.workspaces as Record<string, { repos: Record<string, unknown>[] }>;
    const repos = workspaces.myws.repos;

    expect(repos).toHaveLength(1);
    expect(repos[0]).not.toHaveProperty("tags");
    expect(repos[0].name).toBe("repo-notags");
    expect(repos[0].group).toBe("web");
  });

  // ── 9. Preserves workspace label in output ──────────────────────────────

  it("preserves workspace label in output", async () => {
    const source = makeSource({
      registry: {
        workspaces: {
          labeled: {
            label: "My Labeled Workspace",
            repos: [{ name: "repo-x", group: "default", tags: [] }],
          },
        },
        groups: {},
        tags: {},
      },
    });

    const workspace = makeWorkspace({
      name: "labeled",
      label: "My Labeled Workspace",
      repos: [{ name: "repo-x", group: "default", tags: [] }],
      source,
    });

    mockGetAvailableWorkspaces.mockReturnValue([workspace]);

    await exportWorkspace();

    const output = (stdoutSpy.mock.calls[0][0] as string);
    const parsed = yaml.load(output) as Record<string, unknown>;
    const workspaces = parsed.workspaces as Record<string, { label?: string; repos: unknown[] }>;

    expect(workspaces.labeled.label).toBe("My Labeled Workspace");
  });
});
