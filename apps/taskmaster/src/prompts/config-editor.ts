import { listWithDefault, inputWithDefault, confirmPrompt } from './factory.js';
import type { ProjectConfig } from '../config/schema.js';
import { STYLE_NAMES } from '../config/styles.js';
import { PRESET_NAMES } from '../config/state-presets.js';

interface ConfigKey {
  key: string;
  label: string;
  getter: (config: ProjectConfig) => string;
  validate: (value: string) => boolean | string;
}

const CONFIG_KEYS: ConfigKey[] = [
  {
    key: 'style',
    label: 'Project style',
    getter: (c) => c.style,
    validate: (v) => STYLE_NAMES.includes(v) || `Invalid style. Valid: ${STYLE_NAMES.join(', ')}`,
  },
  {
    key: 'states.preset',
    label: 'Status preset',
    getter: (c) => c.states.preset,
    validate: (v) =>
      [...PRESET_NAMES, 'custom'].includes(v) ||
      `Invalid preset. Valid: ${[...PRESET_NAMES, 'custom'].join(', ')}`,
  },
  {
    key: 'states.enforce_transitions',
    label: 'Enforce transitions',
    getter: (c) => String(c.states.enforce_transitions),
    validate: (v) => ['true', 'false'].includes(v) || 'Must be "true" or "false"',
  },
  {
    key: 'ai.provider',
    label: 'AI provider',
    getter: (c) => c.ai.provider,
    validate: (v) =>
      ['copilot', 'anthropic', 'openai'].includes(v) ||
      'Invalid provider. Valid: copilot, anthropic, openai',
  },
  {
    key: 'ai.model',
    label: 'AI model',
    getter: (c) => c.ai.model,
    validate: (v) => v.trim().length > 0 || 'Model name cannot be empty',
  },
  {
    key: 'thresholds.expand',
    label: 'Auto-expand threshold',
    getter: (c) => String(c.thresholds.expand),
    validate: (v) => {
      const n = Number(v);
      return (Number.isInteger(n) && n >= 1 && n <= 10) || 'Must be integer 1-10';
    },
  },
  {
    key: 'thresholds.flag',
    label: 'Flag-for-review threshold',
    getter: (c) => String(c.thresholds.flag),
    validate: (v) => {
      const n = Number(v);
      return (Number.isInteger(n) && n >= 1 && n <= 10) || 'Must be integer 1-10';
    },
  },
  {
    key: 'skills.auto_infer',
    label: 'Auto-infer skills',
    getter: (c) => String(c.skills.auto_infer),
    validate: (v) => ['true', 'false'].includes(v) || 'Must be "true" or "false"',
  },
];

export interface ConfigEditResult {
  key: string;
  value: string;
  confirmed: boolean;
}

/**
 * Interactive config editor. User picks a key, sees current value, enters new value.
 * Returns the key/value to write, or null if cancelled.
 * CLI handles persistence.
 */
export async function runConfigEditor(
  config: ProjectConfig,
): Promise<ConfigEditResult | null> {
  const keyChoices = CONFIG_KEYS.map((k) => ({
    name: `${k.label} (${k.key} = ${k.getter(config)})`,
    value: k.key,
  }));

  const selectedKey = await listWithDefault(
    'configKey',
    'Select setting to edit:',
    keyChoices,
  );
  const keyDef = CONFIG_KEYS.find((k) => k.key === selectedKey);
  if (!keyDef) return null;

  const currentValue = keyDef.getter(config);
  const newValue = await inputWithDefault(
    'configValue',
    `New value for ${keyDef.label} (current: ${currentValue}):`,
    {
      validate: keyDef.validate,
      defaultValue: currentValue,
    },
  );

  if (newValue === currentValue) {
    return { key: selectedKey, value: newValue, confirmed: false };
  }

  const confirmed = await confirmPrompt(
    `Set ${keyDef.label} to "${newValue}"?`,
    true,
  );
  return { key: selectedKey, value: newValue, confirmed };
}

/**
 * Non-interactive --get: retrieve a config value by dot-notation key.
 * Returns null if the key is unknown.
 */
export function getConfigValue(config: ProjectConfig, key: string): string | null {
  const keyDef = CONFIG_KEYS.find((k) => k.key === key);
  if (!keyDef) return null;
  return keyDef.getter(config);
}

/**
 * Non-interactive --set: validate a value for a given key.
 */
export function validateConfigValue(
  key: string,
  value: string,
): { valid: boolean; error?: string } {
  const keyDef = CONFIG_KEYS.find((k) => k.key === key);
  if (!keyDef) {
    return {
      valid: false,
      error: `Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.map((k) => k.key).join(', ')}`,
    };
  }
  const result = keyDef.validate(value);
  if (result === true) return { valid: true };
  return { valid: false, error: typeof result === 'string' ? result : 'Invalid value' };
}

/**
 * Apply a dot-notation key=value to produce a patch object.
 * CLI is responsible for deep-merging this into config.yaml.
 */
export function applyConfigValue(key: string, value: string): Record<string, unknown> {
  const parts = key.split('.');

  // Parse typed values: booleans and numbers
  let parsed: unknown;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (!isNaN(Number(value)) && value.trim() !== '') parsed = Number(value);
  else parsed = value;

  if (parts.length === 1) {
    return { [key]: parsed };
  }

  // Build nested object, e.g. 'thresholds.expand' -> { thresholds: { expand: 5 } }
  const result: Record<string, unknown> = {};
  let current: Record<string, unknown> = result;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = parsed;
  return result;
}

export { CONFIG_KEYS };
