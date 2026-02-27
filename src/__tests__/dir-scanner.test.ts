import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  access: vi.fn(),
}));

const { readdir, access } = await import("node:fs/promises");
const mockReaddir = vi.mocked(readdir);
const mockAccess = vi.mocked(access);

const { scanDirectory } = await import("../collector/dir-scanner.js");

// Helper to create a Dirent-like object
function dirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as unknown as import("node:fs").Dirent;
}

describe("scanDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("discovers git repos at depth 1", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("frontend", true),
      dirent("backend", true),
      dirent("README.md", false),
    ] as any);

    // frontend has .git, backend has .git
    mockAccess
      .mockResolvedValueOnce(undefined) // frontend/.git
      .mockResolvedValueOnce(undefined); // backend/.git

    const repos = await scanDirectory("/repos", 1);

    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({ path: "/repos/backend", name: "backend" });
    expect(repos[1]).toEqual({ path: "/repos/frontend", name: "frontend" });
  });

  it("skips directories without .git", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("has-git", true),
      dirent("no-git", true),
    ] as any);

    mockAccess
      .mockResolvedValueOnce(undefined) // has-git/.git exists
      .mockRejectedValueOnce(new Error("ENOENT")); // no-git/.git missing

    // no-git has no children (depth 1, no further scanning)
    const repos = await scanDirectory("/repos", 1);

    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("has-git");
  });

  it("skips hidden directories", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent(".hidden-repo", true),
      dirent("visible-repo", true),
    ] as any);

    mockAccess.mockResolvedValueOnce(undefined); // visible-repo/.git

    const repos = await scanDirectory("/repos", 1);

    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("visible-repo");
  });

  it("discovers repos at depth 2", async () => {
    // Root level: one org directory (not a repo)
    mockReaddir.mockResolvedValueOnce([
      dirent("acme", true),
    ] as any);

    mockAccess.mockRejectedValueOnce(new Error("ENOENT")); // acme/.git missing

    // Inside acme: two repos
    mockReaddir.mockResolvedValueOnce([
      dirent("service-a", true),
      dirent("service-b", true),
    ] as any);

    mockAccess
      .mockResolvedValueOnce(undefined) // acme/service-a/.git
      .mockResolvedValueOnce(undefined); // acme/service-b/.git

    const repos = await scanDirectory("/repos", 2);

    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({ path: "/repos/acme/service-a", name: "service-a" });
    expect(repos[1]).toEqual({ path: "/repos/acme/service-b", name: "service-b" });
  });

  it("does not descend into git repos", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("repo-with-submodule", true),
    ] as any);

    // It's a git repo
    mockAccess.mockResolvedValueOnce(undefined);

    const repos = await scanDirectory("/repos", 2);

    expect(repos).toHaveLength(1);
    // readdir should only be called once (root level), not for the repo's contents
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });

  it("returns empty array for empty directory", async () => {
    mockReaddir.mockResolvedValueOnce([] as any);

    const repos = await scanDirectory("/empty", 1);

    expect(repos).toEqual([]);
  });

  it("handles unreadable directories gracefully", async () => {
    mockReaddir.mockRejectedValueOnce(new Error("EACCES"));

    const repos = await scanDirectory("/forbidden", 1);

    expect(repos).toEqual([]);
  });

  it("returns sorted results", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("zebra", true),
      dirent("alpha", true),
      dirent("middle", true),
    ] as any);

    mockAccess
      .mockResolvedValueOnce(undefined) // zebra/.git
      .mockResolvedValueOnce(undefined) // alpha/.git
      .mockResolvedValueOnce(undefined); // middle/.git

    const repos = await scanDirectory("/repos", 1);

    expect(repos.map((r) => r.name)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("defaults to depth 1", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("org-dir", true),
    ] as any);

    mockAccess.mockRejectedValueOnce(new Error("ENOENT")); // org-dir/.git missing

    // Should NOT descend into org-dir at default depth 1
    const repos = await scanDirectory("/repos");

    expect(repos).toEqual([]);
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });
});
