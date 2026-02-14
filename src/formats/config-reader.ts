import { loadProjectConfig, projectConfigExists } from '../config/loader.js';
import type { ProjectConfig } from '../config/schema.js';

export { loadProjectConfig, projectConfigExists };

/**
 * Load config for a project and return the value at a dot-separated key path.
 * E.g., getConfigValue('myProject', 'ai.model') => 'claude-sonnet-4-20250514'
 * Returns undefined if the key path does not exist.
 */
export async function getConfigValue(
  projectName: string,
  keyPath: string,
): Promise<unknown> {
  const config = await loadProjectConfig(projectName);
  return resolveKeyPath(config, keyPath);
}

/**
 * Resolve a dot-separated key path on an object.
 * E.g., resolveKeyPath({ a: { b: 3 } }, 'a.b') => 3
 */
function resolveKeyPath(obj: unknown, keyPath: string): unknown {
  const keys = keyPath.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Load the full project config for a project by name.
 * Re-exported as a convenience alias.
 */
export async function readProjectConfig(projectName: string): Promise<ProjectConfig> {
  return loadProjectConfig(projectName);
}
