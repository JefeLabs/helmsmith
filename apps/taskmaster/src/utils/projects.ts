import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ProjectConfig } from '../config/schema.js';
import { getRepoTaskmasterHome } from './git.js';
import { getHomePath, getProjectDir, scaffoldProjectDir } from './home.js';
import type { ProjectLocation } from './location.js';

const PROJECTS_FILE = 'projects.yaml';

export interface ProjectEntry {
  name: string;
  created: string;
  description: string;
}

export interface TaggedProjectEntry extends ProjectEntry {
  location: ProjectLocation;
}

export interface GlobalProjectsRegistry {
  active: string | null;
  active_location: ProjectLocation | null;
  projects: ProjectEntry[];
}

export interface RepoProjectsRegistry {
  projects: ProjectEntry[];
}

/**
 * Returns the path to the global projects.yaml
 */
export function getGlobalProjectsPath(): string {
  return getHomePath(PROJECTS_FILE);
}

/**
 * Returns the path to a repo-local projects.yaml
 */
export function getRepoProjectsPath(gitRoot: string): string {
  return join(getRepoTaskmasterHome(gitRoot), PROJECTS_FILE);
}

/**
 * Read the global projects.yaml. Returns empty registry if file doesn't exist.
 */
export async function readGlobalProjects(): Promise<GlobalProjectsRegistry> {
  const path = getGlobalProjectsPath();

  if (!existsSync(path)) {
    return { active: null, active_location: null, projects: [] };
  }

  const content = await readFile(path, 'utf-8');
  const parsed = yaml.load(content);

  if (parsed === null || parsed === undefined) {
    return { active: null, active_location: null, projects: [] };
  }

  const registry = parsed as GlobalProjectsRegistry;
  return {
    active: registry.active ?? null,
    active_location: registry.active_location ?? null,
    projects: registry.projects ?? [],
  };
}

/**
 * Read a repo-local projects.yaml. Returns empty registry if file doesn't exist.
 */
export async function readRepoProjects(gitRoot: string): Promise<RepoProjectsRegistry> {
  const path = getRepoProjectsPath(gitRoot);

  if (!existsSync(path)) {
    return { projects: [] };
  }

  const content = await readFile(path, 'utf-8');
  const parsed = yaml.load(content);

  if (parsed === null || parsed === undefined) {
    return { projects: [] };
  }

  const registry = parsed as RepoProjectsRegistry;
  return {
    projects: registry.projects ?? [],
  };
}

/**
 * Write the global projects registry.
 */
export async function writeGlobalProjects(registry: GlobalProjectsRegistry): Promise<void> {
  const content = yaml.dump(registry, { lineWidth: -1, noRefs: true });
  await writeFile(getGlobalProjectsPath(), content, 'utf-8');
}

/**
 * Write a repo-local projects registry.
 */
export async function writeRepoProjects(
  gitRoot: string,
  registry: RepoProjectsRegistry,
): Promise<void> {
  const path = getRepoProjectsPath(gitRoot);
  const content = yaml.dump(registry, { lineWidth: -1, noRefs: true });
  await writeFile(path, content, 'utf-8');
}

/**
 * List all projects from both global and repo-local registries, tagged with location.
 */
export async function listAllProjects(gitRoot?: string | null): Promise<{
  active: string | null;
  activeLocation: ProjectLocation | null;
  projects: TaggedProjectEntry[];
}> {
  const global = await readGlobalProjects();
  const tagged: TaggedProjectEntry[] = global.projects.map((p) => ({
    ...p,
    location: 'home' as const,
  }));

  if (gitRoot) {
    const repo = await readRepoProjects(gitRoot);
    for (const p of repo.projects) {
      tagged.push({ ...p, location: 'repo' as const });
    }
  }

  return {
    active: global.active,
    activeLocation: global.active_location,
    projects: tagged,
  };
}

/**
 * Create a new project. Sets it as active in the global registry.
 * Creates the project directory structure and initializes tasks.json + config.yaml.
 */
export async function createProject(
  name: string,
  location: ProjectLocation,
  gitRoot: string | null,
  description: string = '',
  config?: Partial<ProjectConfig>,
): Promise<ProjectEntry> {
  // Check for duplicates in the target registry
  if (location === 'repo' && gitRoot) {
    const repo = await readRepoProjects(gitRoot);
    if (repo.projects.some((p) => p.name === name)) {
      throw new Error(`Project "${name}" already exists in this repository`);
    }
  } else {
    const global = await readGlobalProjects();
    if (global.projects.some((p) => p.name === name)) {
      throw new Error(`Project "${name}" already exists`);
    }
  }

  // Scaffold the project directory
  await scaffoldProjectDir(name, location, gitRoot);

  const projectDir = getProjectDir(name, location, gitRoot);

  // Write empty tasks.json
  await writeFile(join(projectDir, 'tasks.json'), JSON.stringify([], null, 2), 'utf-8');

  // Write config.yaml
  const defaultConfig = {
    style: config?.style ?? 'task-only',
    states: config?.states ?? {
      preset: 'standard',
      enforce_transitions: false,
    },
    skills: config?.skills ?? {
      vocabulary: ['backend', 'frontend', 'database', 'devops', 'testing'],
      auto_infer: true,
    },
    ai: config?.ai ?? {
      model: 'gpt-4o',
    },
    thresholds: config?.thresholds ?? {
      expand: 5,
      flag: 8,
    },
  };
  await writeFile(
    join(projectDir, 'config.yaml'),
    yaml.dump(defaultConfig, { lineWidth: -1, noRefs: true }),
    'utf-8',
  );

  const entry: ProjectEntry = {
    name,
    created: new Date().toISOString().split('T')[0],
    description,
  };

  // Add to the appropriate registry
  if (location === 'repo' && gitRoot) {
    const repo = await readRepoProjects(gitRoot);
    repo.projects.push(entry);
    await writeRepoProjects(gitRoot, repo);
  } else {
    const global = await readGlobalProjects();
    global.projects.push(entry);
    global.active = name;
    global.active_location = location;
    await writeGlobalProjects(global);
  }

  // Always update global active pointer
  const global = await readGlobalProjects();
  global.active = name;
  global.active_location = location;
  await writeGlobalProjects(global);

  return entry;
}

/**
 * Remove a project from the appropriate registry.
 * Does NOT delete the project directory.
 */
export async function removeProject(
  name: string,
  location: ProjectLocation,
  gitRoot: string | null,
): Promise<void> {
  if (location === 'repo' && gitRoot) {
    const repo = await readRepoProjects(gitRoot);
    const index = repo.projects.findIndex((p) => p.name === name);
    if (index === -1) {
      throw new Error(`Project "${name}" not found in repository`);
    }
    repo.projects.splice(index, 1);
    await writeRepoProjects(gitRoot, repo);
  } else {
    const global = await readGlobalProjects();
    const index = global.projects.findIndex((p) => p.name === name);
    if (index === -1) {
      throw new Error(`Project "${name}" not found`);
    }
    global.projects.splice(index, 1);
    await writeGlobalProjects(global);
  }

  // If the removed project was active, clear the active pointer
  const global = await readGlobalProjects();
  if (global.active === name) {
    global.active = global.projects.length > 0 ? global.projects[0].name : null;
    global.active_location = global.projects.length > 0 ? 'home' : null;
    await writeGlobalProjects(global);
  }
}

/**
 * Switch the active project. Searches both registries.
 */
export async function switchProject(
  name: string,
  location: ProjectLocation,
  gitRoot?: string | null,
): Promise<void> {
  // Verify the project exists in the specified location
  if (location === 'repo') {
    if (!gitRoot) throw new Error('gitRoot is required for repo-local projects');
    const repo = await readRepoProjects(gitRoot);
    if (!repo.projects.some((p) => p.name === name)) {
      throw new Error(`Project "${name}" not found in repository`);
    }
  } else {
    const global = await readGlobalProjects();
    if (!global.projects.some((p) => p.name === name)) {
      throw new Error(`Project "${name}" not found`);
    }
  }

  // Update global active pointer
  const global = await readGlobalProjects();
  global.active = name;
  global.active_location = location;
  await writeGlobalProjects(global);
}

/**
 * Get the active project name and location, or null if none.
 */
export async function getActiveProject(): Promise<{
  name: string;
  location: ProjectLocation;
} | null> {
  const global = await readGlobalProjects();
  if (!global.active) return null;
  return { name: global.active, location: global.active_location ?? 'home' };
}
