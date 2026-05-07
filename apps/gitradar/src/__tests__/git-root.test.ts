import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRevparse = vi.fn();

vi.mock("simple-git", () => {
  const factory = vi.fn(() => ({
    revparse: mockRevparse,
  }));
  return {
    default: factory,
    simpleGit: factory,
  };
});

import { simpleGit } from "simple-git";
import { detectGitRoot } from "../config/git-root.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("detectGitRoot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed root path when inside a git repo", async () => {
    mockRevparse.mockResolvedValue("/home/user/my-project\n");

    const result = await detectGitRoot("/some/dir");

    expect(result).toBe("/home/user/my-project");
  });

  it("returns null when not in a git repo", async () => {
    mockRevparse.mockRejectedValue(new Error("not a git repository"));

    const result = await detectGitRoot("/not/a/repo");

    expect(result).toBeNull();
  });

  it("uses process.cwd() as default when no cwd argument provided", async () => {
    mockRevparse.mockResolvedValue("/current/working/dir\n");

    await detectGitRoot();

    expect(simpleGit).toHaveBeenCalledWith(process.cwd());
  });

  it("passes custom cwd to simpleGit when provided", async () => {
    mockRevparse.mockResolvedValue("/custom/path\n");

    await detectGitRoot("/custom/path");

    expect(simpleGit).toHaveBeenCalledWith("/custom/path");
  });
});
