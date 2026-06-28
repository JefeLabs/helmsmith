import type { ProjectLocation } from '../utils/location.js';
import { createProject, listAllProjects, removeProject, switchProject } from '../utils/projects.js';

export interface ProjectEntry {
  name: string;
  location: ProjectLocation;
  description?: string;
  created: string;
}

export interface ProjectsListResult {
  projects: ProjectEntry[];
  active: string | null;
  activeLocation: ProjectLocation | null;
}

export interface ProjectsCreateResult {
  name: string;
  location: ProjectLocation;
}

/**
 * Execute projects list: list all projects with active marker.
 */
export async function executeProjectsList(gitRoot: string | null): Promise<ProjectsListResult> {
  const all = await listAllProjects(gitRoot);
  return all;
}

/**
 * Execute projects create: create a new project.
 */
export async function executeProjectsCreate(
  name: string,
  location: ProjectLocation,
  gitRoot: string | null,
  description: string = '',
  projectConfig?: Record<string, unknown>,
): Promise<ProjectsCreateResult> {
  await createProject(name, location, gitRoot, description, projectConfig);
  return { name, location };
}

/**
 * Execute projects switch: set the active project.
 * Searches repo projects first, then home.
 */
export async function executeProjectsSwitch(
  name: string,
  gitRoot: string | null,
): Promise<{ name: string; location: ProjectLocation }> {
  if (gitRoot) {
    const { readRepoProjects } = await import('../utils/projects.js');
    const repo = await readRepoProjects(gitRoot);
    if (repo.projects.some((p) => p.name === name)) {
      await switchProject(name, 'repo', gitRoot);
      return { name, location: 'repo' };
    }
  }

  await switchProject(name, 'home');
  return { name, location: 'home' };
}

/**
 * Execute projects remove: remove a project from the registry.
 * Searches repo projects first, then home.
 */
export async function executeProjectsRemove(
  name: string,
  gitRoot: string | null,
): Promise<{ name: string; location: ProjectLocation }> {
  if (gitRoot) {
    const { readRepoProjects } = await import('../utils/projects.js');
    const repo = await readRepoProjects(gitRoot);
    if (repo.projects.some((p) => p.name === name)) {
      await removeProject(name, 'repo', gitRoot);
      return { name, location: 'repo' };
    }
  }

  await removeProject(name, 'home', null);
  return { name, location: 'home' };
}
