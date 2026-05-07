import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LoadedWorkspace,
  RegistrySource,
} from "../config/repos-registry.js";

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => {
  class MockSeparator {
    readonly separator: string;
    readonly type = "separator";
    constructor(separator?: string) {
      this.separator = separator ?? "---";
    }
    static isSeparator(choice: unknown): choice is MockSeparator {
      return (
        typeof choice === "object" &&
        choice !== null &&
        "type" in choice &&
        (choice as { type: string }).type === "separator"
      );
    }
  }

  return {
    select: vi.fn(),
    Separator: MockSeparator,
  };
});

import { select } from "@inquirer/prompts";
import { selectWorkspace } from "../config/workspace-selector.js";

const mockSelect = vi.mocked(select);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSource(
  type: "global" | "project",
  path: string,
): RegistrySource {
  return {
    type,
    path,
    registry: { workspaces: {}, groups: {}, tags: {} },
  };
}

function makeWorkspace(
  name: string,
  source: RegistrySource,
  opts?: { label?: string; repoCount?: number },
): LoadedWorkspace {
  const repoCount = opts?.repoCount ?? 2;
  const repos = Array.from({ length: repoCount }, (_, i) => ({
    name: `${name}-repo-${i + 1}`,
    path: `/code/${name}-repo-${i + 1}`,
    group: "default" as const,
    tags: [] as string[],
  }));
  return {
    name,
    label: opts?.label,
    repos,
    source,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("selectWorkspace", () => {
  const globalSource = makeSource("global", "/home/user/.agentx/repos.yml");
  const projectSource = makeSource(
    "project",
    "/projects/foo/.agentx/repos.yml",
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty workspace list", async () => {
    const result = await selectWorkspace([]);

    expect(result).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns single workspace automatically without prompting", async () => {
    const ws = makeWorkspace("frontend", globalSource, {
      label: "Frontend Apps",
    });

    const result = await selectWorkspace([ws]);

    expect(result).toBe(ws);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns preselected workspace when name matches exactly one", async () => {
    const ws1 = makeWorkspace("frontend", globalSource);
    const ws2 = makeWorkspace("backend", globalSource);

    const result = await selectWorkspace([ws1, ws2], "backend");

    expect(result).toBe(ws2);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns null when preselected name not found", async () => {
    const ws1 = makeWorkspace("frontend", globalSource);
    const ws2 = makeWorkspace("backend", globalSource);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await selectWorkspace([ws1, ws2], "nonexistent");

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'Workspace "nonexistent" not found.',
    );
    expect(mockSelect).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("falls through to prompt when preselected name matches multiple workspaces", async () => {
    const wsGlobal = makeWorkspace("frontend", globalSource, {
      label: "Global Frontend",
    });
    const wsProject = makeWorkspace("frontend", projectSource, {
      label: "Project Frontend",
    });

    mockSelect.mockResolvedValue(wsProject);

    const result = await selectWorkspace(
      [wsGlobal, wsProject],
      "frontend",
    );

    expect(result).toBe(wsProject);
    expect(mockSelect).toHaveBeenCalledOnce();
  });

  it("calls select prompt when multiple workspaces exist", async () => {
    const ws1 = makeWorkspace("frontend", globalSource, {
      label: "Frontend Apps",
      repoCount: 3,
    });
    const ws2 = makeWorkspace("backend", globalSource, {
      repoCount: 1,
    });

    mockSelect.mockResolvedValue(ws1);

    const result = await selectWorkspace([ws1, ws2]);

    expect(result).toBe(ws1);
    expect(mockSelect).toHaveBeenCalledOnce();

    // Verify the prompt configuration
    const callArgs = mockSelect.mock.calls[0][0];
    expect(callArgs.message).toBe("Select workspace:");
    expect(callArgs.choices).toBeDefined();

    // Should contain a separator + 2 workspace choices
    const choices = callArgs.choices as unknown[];
    // 1 separator (global group) + 2 workspace choices = 3
    expect(choices).toHaveLength(3);
  });

  it("groups workspaces by global and project source with separators", async () => {
    const wsGlobal1 = makeWorkspace("frontend", globalSource, {
      label: "Frontend Apps",
      repoCount: 2,
    });
    const wsGlobal2 = makeWorkspace("backend", globalSource, {
      repoCount: 1,
    });
    const wsProject = makeWorkspace("devops", projectSource, {
      label: "DevOps",
      repoCount: 4,
    });

    mockSelect.mockResolvedValue(wsGlobal1);

    await selectWorkspace([wsGlobal1, wsGlobal2, wsProject]);

    const callArgs = mockSelect.mock.calls[0][0];
    const choices = callArgs.choices as unknown[];

    // 1 global separator + 2 global workspaces + 1 project separator + 1 project workspace = 5
    expect(choices).toHaveLength(5);

    // First choice should be a Separator for global
    const { Separator } = await import("@inquirer/prompts");
    expect(choices[0]).toBeInstanceOf(Separator);

    // Second and third should be workspace choices
    const choice1 = choices[1] as { name: string; value: LoadedWorkspace };
    expect(choice1.name).toBe("frontend — Frontend Apps (2 repos)");
    expect(choice1.value).toBe(wsGlobal1);

    const choice2 = choices[2] as { name: string; value: LoadedWorkspace };
    expect(choice2.name).toBe("backend (1 repos)");
    expect(choice2.value).toBe(wsGlobal2);

    // Fourth should be a Separator for project
    expect(choices[3]).toBeInstanceOf(Separator);

    // Fifth should be the project workspace
    const choice3 = choices[4] as { name: string; value: LoadedWorkspace };
    expect(choice3.name).toBe("devops — DevOps (4 repos)");
    expect(choice3.value).toBe(wsProject);
  });

  it("formats choice names with label and repo count", async () => {
    const wsWithLabel = makeWorkspace("frontend", globalSource, {
      label: "My Frontend",
      repoCount: 5,
    });
    const wsWithoutLabel = makeWorkspace("backend", globalSource, {
      repoCount: 3,
    });

    mockSelect.mockResolvedValue(wsWithLabel);

    await selectWorkspace([wsWithLabel, wsWithoutLabel]);

    const callArgs = mockSelect.mock.calls[0][0];
    const choices = callArgs.choices as unknown[];

    // Skip the separator (index 0)
    const labeledChoice = choices[1] as { name: string };
    const unlabeledChoice = choices[2] as { name: string };

    expect(labeledChoice.name).toBe("frontend — My Frontend (5 repos)");
    expect(unlabeledChoice.name).toBe("backend (3 repos)");
  });
});
