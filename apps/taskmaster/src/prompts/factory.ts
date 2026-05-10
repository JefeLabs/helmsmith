import {
  checkbox,
  confirm,
  input,
  number as numberPrompt,
  search,
  select,
} from '@inquirer/prompts';
import { type Defaults, readDefaults } from '../utils/defaults.js';

// Lazy-loaded, cached defaults
let cachedDefaults: Defaults | null = null;

async function getDefaults(): Promise<Defaults> {
  if (!cachedDefaults) {
    cachedDefaults = await readDefaults();
  }
  return cachedDefaults;
}

/**
 * Reset the cached defaults (for testing).
 */
export function resetDefaultsCache(): void {
  cachedDefaults = null;
}

/**
 * Resolve a default value from cached defaults by dot-path key.
 * Supports keys like 'style', 'model', 'statusPreset', 'skills',
 * 'thresholds.expand', 'thresholds.flag'.
 */
export async function resolveDefault(key: string): Promise<unknown> {
  const defaults = await getDefaults();
  const parts = key.split('.');
  let current: unknown = defaults;
  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Text input with auto-populated default from defaults.yaml.
 */
export async function inputWithDefault(
  name: string,
  message: string,
  opts?: { validate?: (v: string) => boolean | string; defaultValue?: string },
): Promise<string> {
  const savedDefault = await resolveDefault(name);
  const fallback =
    opts?.defaultValue ?? (typeof savedDefault === 'string' ? savedDefault : undefined);
  return input({ message, default: fallback, validate: opts?.validate });
}

/**
 * Single-select list with auto-populated default from defaults.yaml.
 */
export async function listWithDefault<T extends string>(
  name: string,
  message: string,
  choices: Array<{ name: string; value: T; description?: string }>,
): Promise<T> {
  const savedDefault = await resolveDefault(name);
  const defaultValue = typeof savedDefault === 'string' ? (savedDefault as T) : undefined;
  return select({ message, choices, default: defaultValue });
}

/**
 * Multi-select checkbox with auto-checked items from defaults.yaml.
 */
export async function checkboxWithDefaults<T extends string>(
  name: string,
  message: string,
  choices: Array<{ name: string; value: T }>,
): Promise<T[]> {
  const savedDefault = await resolveDefault(name);
  const savedArray = Array.isArray(savedDefault) ? savedDefault : [];
  const markedChoices = choices.map((c) => ({
    ...c,
    checked: savedArray.includes(c.value),
  }));
  return checkbox({ message, choices: markedChoices });
}

/**
 * Yes/no confirmation prompt.
 */
export async function confirmPrompt(message: string, defaultValue?: boolean): Promise<boolean> {
  return confirm({ message, default: defaultValue ?? true });
}

/**
 * Numeric input with auto-populated default from defaults.yaml.
 */
export async function numberWithDefault(
  name: string,
  message: string,
  opts?: { min?: number; max?: number; defaultValue?: number },
): Promise<number> {
  const savedDefault = await resolveDefault(name);
  const fallback =
    opts?.defaultValue ?? (typeof savedDefault === 'number' ? savedDefault : undefined);

  const result = await numberPrompt({ message, default: fallback, min: opts?.min, max: opts?.max });

  // @inquirer/prompts number can return undefined if user enters nothing with no default
  if (result === undefined) {
    return opts?.defaultValue ?? 0;
  }
  return result;
}

/**
 * Searchable select (autocomplete) for choosing from a list by typing.
 */
export async function searchPrompt<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; description?: string }>,
): Promise<T> {
  return search({
    message,
    source: async (term) => {
      if (!term) return choices;
      const lower = term.toLowerCase();
      return choices.filter(
        (c) => c.name.toLowerCase().includes(lower) || c.value.toLowerCase().includes(lower),
      );
    },
  });
}
