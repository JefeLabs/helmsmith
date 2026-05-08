import { readGlobalProjects, readRepoProjects } from '../utils/projects.js';
import { getProjectDir, getTaskmasterHomeFor } from '../utils/home.js';
import { parseProjectRef } from '../utils/location.js';
import type { ProjectLocation, ResolvedProject } from '../utils/location.js';
import { CLI_BIN_NAME } from './branding.js';
import { existsSync } from 'node:fs';

/**
 * Resolve the active project using the following priority:
 *   1. Explicit --project flag (supports "repo:name" qualifier; tries repo then home)
 *   2. `active` + `active_location` from global projects.yaml
 *   3. Repo-local auto-detect (single project in repo)
 *   4. Home auto-detect (single project globally)
 *
 * Returns a ResolvedProject or null if none can be resolved.
 */
export async function resolveProject(
  explicitProject?: string,
  gitRoot?: string | null,
): Promise<ResolvedProject | null> {
  // 1. Explicit --project flag
  if (explicitProject) {
    const { name, location: explicitLocation } = parseProjectRef(explicitProject);

    // If location specified, search only that registry
    if (explicitLocation) {
      return resolveInLocation(name, explicitLocation, gitRoot);
    }

    // No qualifier — try repo first, then home
    if (gitRoot) {
      const repoResult = await tryResolveInLocation(name, 'repo', gitRoot);
      if (repoResult) return repoResult;
    }
    const homeResult = await tryResolveInLocation(name, 'home', gitRoot);
    if (homeResult) return homeResult;

    throw new Error(
      `Project "${explicitProject}" not found. Run '${CLI_BIN_NAME} projects list' to see available projects.`,
    );
  }

  // 2. Active project from global registry
  const global = await readGlobalProjects();
  if (global.active) {
    const location: ProjectLocation = global.active_location ?? 'home';
    const resolved = await tryResolveInLocation(global.active, location, gitRoot);
    if (resolved) return resolved;
  }

  // 3. Repo-local auto-detect (single project)
  if (gitRoot) {
    const repo = await readRepoProjects(gitRoot);
    if (repo.projects.length === 1) {
      return buildResolved(repo.projects[0].name, 'repo', gitRoot);
    }
  }

  // 4. Home auto-detect (single project)
  if (global.projects.length === 1) {
    return buildResolved(global.projects[0].name, 'home', gitRoot);
  }

  return null;
}

/**
 * Resolve project or throw with a helpful error message.
 */
export async function resolveProjectOrThrow(
  explicitProject?: string,
  gitRoot?: string | null,
): Promise<ResolvedProject> {
  const project = await resolveProject(explicitProject, gitRoot);

  if (!project) {
    throw new Error(
      `No active project. Run '${CLI_BIN_NAME} projects create <name>' to create one, or use --project <name>.`,
    );
  }

  return project;
}

/**
 * Try to resolve a project in a specific location. Returns null if not found.
 */
async function tryResolveInLocation(
  name: string,
  location: ProjectLocation,
  gitRoot?: string | null,
): Promise<ResolvedProject | null> {
  if (location === 'repo') {
    if (!gitRoot) return null;
    const repo = await readRepoProjects(gitRoot);
    if (repo.projects.some((p) => p.name === name)) {
      return buildResolved(name, 'repo', gitRoot);
    }
    return null;
  }

  const global = await readGlobalProjects();
  if (global.projects.some((p) => p.name === name)) {
    return buildResolved(name, 'home', gitRoot);
  }
  return null;
}

/**
 * Resolve in a specific location, throwing if not found.
 */
async function resolveInLocation(
  name: string,
  location: ProjectLocation,
  gitRoot?: string | null,
): Promise<ResolvedProject> {
  const result = await tryResolveInLocation(name, location, gitRoot);
  if (!result) {
    const locationLabel = location === 'repo' ? 'repository' : 'home';
    throw new Error(
      `Project "${name}" not found in ${locationLabel}. Run '${CLI_BIN_NAME} projects list' to see available projects.`,
    );
  }
  return result;
}

/**
 * Build a ResolvedProject from resolved params.
 */
function buildResolved(name: string, location: ProjectLocation, gitRoot?: string | null): ResolvedProject {
  return {
    name,
    location,
    projectDir: getProjectDir(name, location, gitRoot),
    taskmasterHome: getTaskmasterHomeFor(location, gitRoot),
    gitRoot: gitRoot ?? null,
  };
}
