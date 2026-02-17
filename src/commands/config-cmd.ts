import type { ProjectConfig } from '../config/schema.js';
import {
  runConfigEditor,
  getConfigValue,
  validateConfigValue,
  applyConfigValue,
  CONFIG_KEYS,
} from '../prompts/config-editor.js';

export interface ConfigGetResult {
  value: string;
}

export interface ConfigSetResult {
  key: string;
  value: string;
  patch: Partial<ProjectConfig>;
}

export interface ConfigEditResult {
  key: string;
  value: string;
  patch: Partial<ProjectConfig>;
}

/**
 * Execute config --get: retrieve a configuration value by key.
 */
export function executeConfigGet(
  config: ProjectConfig,
  key: string,
): ConfigGetResult {
  const value = getConfigValue(config, key);
  if (value === null) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.map((k) => k.key).join(', ')}`,
    );
  }
  return { value };
}

/**
 * Execute config --set: validate and build a config patch for a key=value pair.
 */
export function executeConfigSet(
  key: string,
  value: string,
): ConfigSetResult {
  const validation = validateConfigValue(key, value);
  if (!validation.valid) {
    throw new Error(validation.error!);
  }
  const patch = applyConfigValue(key, value);
  return { key, value, patch };
}

/**
 * Execute interactive config editor and return the patch, or null if cancelled.
 */
export async function executeConfigEdit(
  config: ProjectConfig,
): Promise<ConfigEditResult | null> {
  const result = await runConfigEditor(config);
  if (!result || !result.confirmed) {
    return null;
  }
  const patch = applyConfigValue(result.key, result.value);
  return { key: result.key, value: result.value, patch };
}
