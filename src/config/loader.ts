import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { ProjectConfigSchema, type ProjectConfig } from './schema.js';
import { getProjectDir } from '../utils/home.js';
import { readDefaults } from '../utils/defaults.js';

/**
 * Load and validate a project's config.yaml.
 * Merges with global defaults — project config takes precedence.
 */
export async function loadProjectConfig(projectName: string): Promise<ProjectConfig> {
  const defaults = await readDefaults();
  const configPath = join(getProjectDir(projectName), 'config.yaml');

  let projectConfig: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const content = await readFile(configPath, 'utf-8');
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object') {
      projectConfig = parsed as Record<string, unknown>;
    }
  }

  // Merge: project config overrides global defaults
  const merged = {
    style: projectConfig.style ?? defaults.style ?? 'task-only',
    states: projectConfig.states ?? { preset: defaults.statusPreset ?? 'standard' },
    skills: projectConfig.skills ?? {
      vocabulary: defaults.skills ?? [],
      auto_infer: true,
    },
    ai: projectConfig.ai ?? { model: defaults.model ?? 'gpt-4o' },
    thresholds: projectConfig.thresholds ?? defaults.thresholds ?? { expand: 5, flag: 8 },
  };

  return ProjectConfigSchema.parse(merged);
}

/**
 * Check if a project config.yaml exists.
 */
export function projectConfigExists(projectName: string): boolean {
  return existsSync(join(getProjectDir(projectName), 'config.yaml'));
}

/**
 * Write a partial config patch to a project's config.yaml.
 * Deep-merges the patch into the existing config and validates with Zod.
 */
export async function writeProjectConfig(
  projectName: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const configPath = join(getProjectDir(projectName), 'config.yaml');
  const existing = await loadProjectConfig(projectName);
  const merged = deepMerge(existing as unknown as Record<string, unknown>, patch);
  const validated = ProjectConfigSchema.parse(merged);
  await writeFile(
    configPath,
    yaml.dump(validated, { lineWidth: -1, noRefs: true }),
    'utf-8',
  );
}

/**
 * Deep-merge source into target, returning a new object.
 * Arrays and non-object values from source overwrite target.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
