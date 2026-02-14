import { readProjects } from '../utils/projects.js';

/**
 * Resolve the active project name using the following priority:
 *   1. Explicit --project flag value
 *   2. `active` field in projects.yaml
 *   3. Single-project auto-detect (if only one project exists)
 *
 * Returns the project name or null if none can be resolved.
 */
export async function resolveProject(explicitProject?: string): Promise<string | null> {
  // 1. Explicit flag takes highest priority
  if (explicitProject) {
    const registry = await readProjects();
    const found = registry.projects.some((p) => p.name === explicitProject);
    if (!found) {
      throw new Error(
        `Project "${explicitProject}" not found. Run 'agentx-taskmaster projects list' to see available projects.`,
      );
    }
    return explicitProject;
  }

  // 2. Active project in projects.yaml
  const registry = await readProjects();

  if (registry.active) {
    return registry.active;
  }

  // 3. Single-project auto-detect
  if (registry.projects.length === 1) {
    return registry.projects[0].name;
  }

  return null;
}

/**
 * Resolve project or throw with a helpful error message.
 */
export async function resolveProjectOrThrow(explicitProject?: string): Promise<string> {
  const project = await resolveProject(explicitProject);

  if (!project) {
    throw new Error(
      'No active project. Run \'agentx-taskmaster projects create <name>\' to create one, or use --project <name>.',
    );
  }

  return project;
}
