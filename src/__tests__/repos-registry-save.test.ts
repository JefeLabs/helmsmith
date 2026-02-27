import { describe, it, expect } from "vitest";
import { addReposToWorkspace, removeRepoFromWorkspace } from "../config/repos-registry.js";
import type { LoadedWorkspace, RegistrySource } from "../config/repos-registry.js";
import type { ReposRegistry } from "../types/schema.js";

function makeWorkspace(repos: Array<{ name: string; path: string; group: string }>): LoadedWorkspace {
  const registry: ReposRegistry = {
    workspaces: {
      test: {
        repos: repos.map((r) => ({ name: r.name, path: r.path, group: r.group, tags: [] })),
      },
    },
    groups: {},
    tags: {},
  };

  const source: RegistrySource = {
    type: "global",
    path: "/home/user/.agentx/repos.yml",
    registry,
  };

  return {
    name: "test",
    repos: registry.workspaces["test"].repos,
    source,
  };
}

describe("addReposToWorkspace", () => {
  it("adds new repos to empty workspace", () => {
    const ws = makeWorkspace([]);
    const added = addReposToWorkspace(ws, [
      { name: "frontend", path: "/repos/frontend", group: "web" },
      { name: "backend", path: "/repos/backend", group: "api" },
    ]);

    expect(added).toBe(2);
    expect(ws.repos).toHaveLength(2);
    expect(ws.repos[0].name).toBe("frontend");
    expect(ws.repos[1].name).toBe("backend");
  });

  it("skips repos with duplicate names", () => {
    const ws = makeWorkspace([
      { name: "frontend", path: "/repos/frontend", group: "web" },
    ]);

    const added = addReposToWorkspace(ws, [
      { name: "frontend", path: "/other/frontend", group: "web" },
      { name: "backend", path: "/repos/backend", group: "api" },
    ]);

    expect(added).toBe(1);
    expect(ws.repos).toHaveLength(2);
    // Original path preserved for duplicate
    expect(ws.repos[0].path).toBe("/repos/frontend");
  });

  it("returns 0 when all repos already exist", () => {
    const ws = makeWorkspace([
      { name: "frontend", path: "/repos/frontend", group: "web" },
    ]);

    const added = addReposToWorkspace(ws, [
      { name: "frontend", path: "/repos/frontend", group: "web" },
    ]);

    expect(added).toBe(0);
    expect(ws.repos).toHaveLength(1);
  });

  it("keeps source registry in sync", () => {
    const ws = makeWorkspace([]);
    addReposToWorkspace(ws, [
      { name: "new-repo", path: "/repos/new-repo", group: "default" },
    ]);

    // The source registry should also have the new repo
    const sourceRepos = ws.source.registry.workspaces["test"].repos;
    expect(sourceRepos).toHaveLength(1);
    expect(sourceRepos[0].name).toBe("new-repo");
  });

  it("handles empty input", () => {
    const ws = makeWorkspace([
      { name: "existing", path: "/repos/existing", group: "default" },
    ]);

    const added = addReposToWorkspace(ws, []);

    expect(added).toBe(0);
    expect(ws.repos).toHaveLength(1);
  });
});

describe("removeRepoFromWorkspace", () => {
  it("removes a repo by name", () => {
    const ws = makeWorkspace([
      { name: "frontend", path: "/repos/frontend", group: "web" },
      { name: "backend", path: "/repos/backend", group: "api" },
    ]);

    const removed = removeRepoFromWorkspace(ws, "frontend");

    expect(removed).toBe(true);
    expect(ws.repos).toHaveLength(1);
    expect(ws.repos[0].name).toBe("backend");
  });

  it("returns false for unknown repo", () => {
    const ws = makeWorkspace([
      { name: "frontend", path: "/repos/frontend", group: "web" },
    ]);

    const removed = removeRepoFromWorkspace(ws, "nonexistent");

    expect(removed).toBe(false);
    expect(ws.repos).toHaveLength(1);
  });

  it("keeps source registry in sync", () => {
    const ws = makeWorkspace([
      { name: "frontend", path: "/repos/frontend", group: "web" },
      { name: "backend", path: "/repos/backend", group: "api" },
    ]);

    removeRepoFromWorkspace(ws, "frontend");

    const sourceRepos = ws.source.registry.workspaces["test"].repos;
    expect(sourceRepos).toHaveLength(1);
    expect(sourceRepos[0].name).toBe("backend");
  });
});
