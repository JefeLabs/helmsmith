import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import yaml from 'js-yaml';
import { getHomePath, getProjectDir, scaffoldProjectDir } from './home.js';
import type { ProjectConfig } from '../config/schema.js';

const PROJECTS_FILE = 'projects.yaml';

export interface ProjectEntry {
  name: string;
  created: string;
  description: string;
}

export interface ProjectsRegistry {
  active: string | null;
  projects: ProjectEntry[];
}

/**
 * Returns the path to projects.yaml
 */
export function getProjectsPath(): string {
  return getHomePath(PROJECTS_FILE);
}

/**
 * Read projects.yaml. Returns empty registry if file doesn't exist.
 */
export async function readProjects(): Promise<ProjectsRegistry> {
  const path = getProjectsPath();

  if (!existsSync(path)) {
    return { active: null, projects: [] };
  }

  const content = await readFile(path, 'utf-8');
  const parsed = yaml.load(content);

  if (parsed === null || parsed === undefined) {
    return { active: null, projects: [] };
  }

  const registry = parsed as ProjectsRegistry;
  return {
    active: registry.active ?? null,
    projects: registry.projects ?? [],
  };
}

/**
 * Write the full projects registry to projects.yaml.
 */
export async function writeProjects(registry: ProjectsRegistry): Promise<void> {
  const content = yaml.dump(registry, { lineWidth: -1, noRefs: true });
  await writeFile(getProjectsPath(), content, 'utf-8');
}

/**
 * Add a new project to the registry. Sets it as active.
 * Creates the project directory structure and initializes tasks.json.
 */
export async function createProject(
  name: string,
  description: string = '',
  config?: Partial<ProjectConfig>,
): Promise<ProjectEntry> {
  const registry = await readProjects();

  if (registry.projects.some((p) => p.name === name)) {
    throw new Error(`Project "${name}" already exists`);
  }

  // Scaffold the project directory
  await scaffoldProjectDir(name);

  // Write empty tasks.json
  const tasksJsonPath = `${getProjectDir(name)}/tasks.json`;
  await writeFile(tasksJsonPath, JSON.stringify([], null, 2), 'utf-8');

  // Write config.yaml — merge caller-provided config with defaults
  const configYamlPath = `${getProjectDir(name)}/config.yaml`;
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
  await writeFile(configYamlPath, yaml.dump(defaultConfig, { lineWidth: -1, noRefs: true }), 'utf-8');

  const entry: ProjectEntry = {
    name,
    created: new Date().toISOString().split('T')[0],
    description,
  };

  registry.projects.push(entry);
  registry.active = name;
  await writeProjects(registry);

  return entry;
}

/**
 * Remove a project from the registry.
 * Does NOT delete the project directory (caller should handle with confirmation).
 */
export async function removeProject(name: string): Promise<void> {
  const registry = await readProjects();
  const index = registry.projects.findIndex((p) => p.name === name);

  if (index === -1) {
    throw new Error(`Project "${name}" not found`);
  }

  registry.projects.splice(index, 1);

  if (registry.active === name) {
    registry.active = registry.projects.length > 0 ? registry.projects[0].name : null;
  }

  await writeProjects(registry);
}

/**
 * Switch the active project.
 */
export async function switchProject(name: string): Promise<void> {
  const registry = await readProjects();

  if (!registry.projects.some((p) => p.name === name)) {
    throw new Error(`Project "${name}" not found`);
  }

  registry.active = name;
  await writeProjects(registry);
}

/**
 * Get the active project name, or null if none.
 */
export async function getActiveProject(): Promise<string | null> {
  const registry = await readProjects();
  return registry.active;
}

/**
 * List all projects.
 */
export async function listProjects(): Promise<ProjectEntry[]> {
  const registry = await readProjects();
  return registry.projects;
}
