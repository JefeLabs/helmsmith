import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/user"),
}));

vi.mock("../store/paths.js", () => ({
  expandTilde: vi.fn((p: string) => {
    if (p === "~") return "/home/user";
    if (p.startsWith("~/")) return "/home/user/" + p.slice(2);
    return p;
  }),
}));

vi.mock("../config/repos-registry.js", () => ({
  loadReposRegistry: vi.fn(),
}));

vi.mock("../config/git-root.js", () => ({
  detectGitRoot: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
  input: vi.fn(),
}));

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { select, input } from "@inquirer/prompts";
import { loadReposRegistry } from "../config/repos-registry.js";
import { detectGitRoot } from "../config/git-root.js";
import { importWorkspace } from "../commands/import.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockRename = vi.mocked(rename);
const mockSelect = vi.mocked(select);
const mockInput = vi.mocked(input);
const mockLoadReposRegistry = vi.mocked(loadReposRegistry);
const mockDetectGitRoot = vi.mocked(detectGitRoot);

// ── Test Fixtures ────────────────────────────────────────────────────────────

const singleWorkspaceYaml = `
workspaces:
  frontend:
    label: Frontend Apps
    repos:
      - name: web-app
        group: web
        tags:
          - react
      - name: mobile-app
        group: mobile
groups:
  web:
    label: Web Projects
tags:
  react:
    label: React Apps
`;

const multiWorkspaceYaml = `
workspaces:
  frontend:
    label: Frontend Apps
    repos:
      - name: web-app
        group: web
  backend:
    label: Backend Services
    repos:
      - name: api-server
        group: api
`;

const emptyWorkspacesYaml = `
workspaces: {}
`;

const invalidYaml = `
workspaces:
  broken: [[[not valid
`;

const schemaInvalidYaml = `
not_workspaces:
  - wrong format
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupDefaults() {
  mockDetectGitRoot.mockResolvedValue(null);
  mockLoadReposRegistry.mockResolvedValue(null);
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockInput.mockResolvedValue("~/code/some-repo");
}

// ── File Handling ────────────────────────────────────────────────────────────

describe("importWorkspace — file handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows error for non-existent file", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await importWorkspace("/does/not/exist.yml");

    expect(errorSpy).toHaveBeenCalledWith("File not found: /does/not/exist.yml");
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    errorSpy.mockRestore();
  });

  it("shows error for invalid YAML", async () => {
    mockReadFile.mockResolvedValue(invalidYaml);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await importWorkspace("/path/to/bad.yml");

    expect(errorSpy).toHaveBeenCalledWith("Invalid YAML in /path/to/bad.yml");
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    errorSpy.mockRestore();
  });

  it("shows error for invalid schema", async () => {
    mockReadFile.mockResolvedValue(schemaInvalidYaml);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await importWorkspace("/path/to/invalid.yml");

    expect(errorSpy).toHaveBeenCalledWith("Invalid repos.yml format in /path/to/invalid.yml");
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    errorSpy.mockRestore();
  });

  it("shows error for empty workspaces", async () => {
    mockReadFile.mockResolvedValue(emptyWorkspacesYaml);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await importWorkspace("/path/to/empty.yml");

    expect(errorSpy).toHaveBeenCalledWith("Imported file contains no workspaces.");
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    errorSpy.mockRestore();
  });
});

// ── Workspace Selection ──────────────────────────────────────────────────────

describe("importWorkspace — workspace selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-selects single workspace without prompting", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    // select should be called for destination, but NOT for workspace selection
    // With no git root, destination is auto-selected to global
    // select is never called (single workspace + no git root + no existing workspaces)
    expect(mockSelect).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Which workspace to import?" })
    );

    logSpy.mockRestore();
  });

  it("prompts for workspace when multiple exist", async () => {
    mockReadFile.mockResolvedValue(multiWorkspaceYaml);
    mockSelect.mockResolvedValue("frontend");
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Which workspace to import?" })
    );

    logSpy.mockRestore();
  });
});

// ── Destination Selection ────────────────────────────────────────────────────

describe("importWorkspace — destination selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers global only when not in git project", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockDetectGitRoot.mockResolvedValue(null);
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    // Should log the "not in git project" message and NOT prompt for destination
    expect(logSpy).toHaveBeenCalledWith("Not inside a git project. Using global destination.");

    logSpy.mockRestore();
  });

  it("offers both global and project when in git project", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockDetectGitRoot.mockResolvedValue("/my/project");
    mockSelect.mockResolvedValue({
      type: "global",
      path: "/home/user/.agentx/repos.yml",
    });
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Import destination:",
        choices: expect.arrayContaining([
          expect.objectContaining({ name: expect.stringContaining("Global") }),
          expect.objectContaining({ name: expect.stringContaining("Project") }),
        ]),
      })
    );

    logSpy.mockRestore();
  });
});

// ── Target Workspace ─────────────────────────────────────────────────────────

describe("importWorkspace — target workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates new workspace when no existing registry", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue(null);
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    // Should NOT prompt for target workspace (no existing workspaces)
    const selectCalls = mockSelect.mock.calls;
    const targetWsCall = selectCalls.find(
      (call) => (call[0] as { message: string }).message === "Target workspace:"
    );
    expect(targetWsCall).toBeUndefined();

    logSpy.mockRestore();
  });

  it("shows merge options when existing workspaces exist", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue({
      workspaces: {
        existing: {
          label: "Existing WS",
          repos: [{ name: "old-repo", path: "/old/path", group: "default", tags: [] }],
        },
      },
      groups: {},
      tags: {},
    });
    // First select call: destination (won't happen since no git root)
    // Only select call: target workspace
    mockSelect.mockResolvedValue("__new__:frontend");
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Target workspace:",
        choices: expect.arrayContaining([
          expect.objectContaining({
            name: expect.stringContaining("Merge into"),
          }),
          expect.objectContaining({
            name: expect.stringContaining("Create new workspace"),
          }),
        ]),
      })
    );

    logSpy.mockRestore();
  });

  it("merges into existing workspace when selected", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue({
      workspaces: {
        frontend: {
          label: "My Frontend",
          repos: [],
        },
      },
      groups: {},
      tags: {},
    });
    mockSelect.mockResolvedValue("frontend");
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    // Verify it wrote to the file with repos added to existing workspace
    expect(mockWriteFile).toHaveBeenCalled();
    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain("web-app");
    expect(writtenContent).toContain("mobile-app");

    logSpy.mockRestore();
  });
});

// ── Path Prompting ───────────────────────────────────────────────────────────

describe("importWorkspace — path prompting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves existing repo paths without prompting", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue({
      workspaces: {
        frontend: {
          label: "Frontend",
          repos: [
            { name: "web-app", path: "/existing/path", group: "web", tags: ["react"] },
          ],
        },
      },
      groups: {},
      tags: {},
    });
    mockSelect.mockResolvedValue("frontend");
    // Only one new repo (mobile-app), so input is called once
    mockInput.mockResolvedValue("~/code/mobile-app");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    // input should only be called once for mobile-app (web-app already exists)
    expect(mockInput).toHaveBeenCalledTimes(1);
    expect(mockInput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("mobile-app"),
      })
    );

    // Verify the existing path is preserved in output
    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain("/existing/path");

    logSpy.mockRestore();
  });

  it("prompts for new repos with default suggestion", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("~/projects/web-app");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    // Should prompt for both repos with defaults
    expect(mockInput).toHaveBeenCalledWith(
      expect.objectContaining({
        default: "~/code/web-app",
      })
    );
    expect(mockInput).toHaveBeenCalledWith(
      expect.objectContaining({
        default: "~/code/mobile-app",
      })
    );

    logSpy.mockRestore();
  });

  it("handles skip by saving repo without path", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    // Repos should be saved but without a path field
    expect(writtenContent).toContain("web-app");
    expect(writtenContent).toContain("mobile-app");
    // "skip" should NOT appear as a path value
    expect(writtenContent).not.toContain("skip");

    logSpy.mockRestore();
  });

  it("handles empty input by saving repo without path", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain("web-app");

    logSpy.mockRestore();
  });
});

// ── Merge Logic ──────────────────────────────────────────────────────────────

describe("importWorkspace — merge logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends new repos to workspace", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue({
      workspaces: {
        frontend: {
          label: "Frontend",
          repos: [
            { name: "existing-app", path: "/existing/path", group: "default", tags: [] },
          ],
        },
      },
      groups: {},
      tags: {},
    });
    mockSelect.mockResolvedValue("frontend");
    mockInput.mockResolvedValue("~/code/some-repo");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    expect(writtenContent).toContain("existing-app");
    expect(writtenContent).toContain("web-app");
    expect(writtenContent).toContain("mobile-app");

    logSpy.mockRestore();
  });

  it("updates existing repos group/tags but preserves path", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue({
      workspaces: {
        frontend: {
          label: "Frontend",
          repos: [
            { name: "web-app", path: "/my/custom/path", group: "old-group", tags: ["existing-tag"] },
          ],
        },
      },
      groups: {},
      tags: {},
    });
    mockSelect.mockResolvedValue("frontend");
    // Only mobile-app is new
    mockInput.mockResolvedValue("~/code/mobile-app");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    // Path should be preserved
    expect(writtenContent).toContain("/my/custom/path");
    // Group should be updated from imported file
    expect(writtenContent).toContain("web");
    // Tags should be merged
    expect(writtenContent).toContain("existing-tag");
    expect(writtenContent).toContain("react");

    logSpy.mockRestore();
  });

  it("appends new groups without overwriting existing", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue({
      workspaces: {},
      groups: {
        web: { label: "My Custom Label" },
        other: { label: "Other Group" },
      },
      tags: {},
    });
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    // Existing "web" group label should be preserved (not overwritten)
    expect(writtenContent).toContain("My Custom Label");
    // "other" group should still be there
    expect(writtenContent).toContain("Other Group");

    logSpy.mockRestore();
  });

  it("appends new tags without overwriting existing", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockLoadReposRegistry.mockResolvedValue({
      workspaces: {},
      groups: {},
      tags: {
        react: { label: "My React Label" },
        vue: { label: "Vue Apps" },
      },
    });
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    // Existing "react" tag label should be preserved
    expect(writtenContent).toContain("My React Label");
    // "vue" tag should still be there
    expect(writtenContent).toContain("Vue Apps");

    logSpy.mockRestore();
  });
});

// ── Save ─────────────────────────────────────────────────────────────────────

describe("importWorkspace — save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates parent directories", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    expect(mockMkdir).toHaveBeenCalledWith(
      "/home/user/.agentx",
      { recursive: true }
    );

    logSpy.mockRestore();
  });

  it("writes valid YAML", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("~/code/web-app");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    expect(mockWriteFile).toHaveBeenCalled();
    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    // Should be valid YAML
    expect(() => {
      const parsed = require("js-yaml").load(writtenContent);
      expect(parsed).toHaveProperty("workspaces");
    }).not.toThrow();

    logSpy.mockRestore();
  });

  it("uses atomic write (writes to .tmp then renames)", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    const destPath = "/home/user/.agentx/repos.yml";
    const tmpPath = destPath + ".tmp";

    expect(mockWriteFile).toHaveBeenCalledWith(tmpPath, expect.any(String), "utf-8");
    expect(mockRename).toHaveBeenCalledWith(tmpPath, destPath);

    // Ensure write happens before rename
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0];
    const renameOrder = mockRename.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(renameOrder);

    logSpy.mockRestore();
  });

  it("logs success message after import", async () => {
    mockReadFile.mockResolvedValue(singleWorkspaceYaml);
    mockInput.mockResolvedValue("skip");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importWorkspace("/path/to/repos.yml");

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Imported workspace")
    );

    logSpy.mockRestore();
  });
});
