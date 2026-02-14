import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import yaml from 'js-yaml';
import { getHomePath } from './home.js';

const DEFAULTS_FILE = 'defaults.yaml';

export interface Defaults {
  model?: string;
  style?: string;
  statusPreset?: string;
  skills?: string[];
  thresholds?: {
    expand?: number;
    flag?: number;
  };
}

/**
 * Returns the path to defaults.yaml
 */
export function getDefaultsPath(): string {
  return getHomePath(DEFAULTS_FILE);
}

/**
 * Check whether defaults.yaml exists (first-run detection).
 */
export function defaultsExist(): boolean {
  return existsSync(getDefaultsPath());
}

/**
 * Read defaults.yaml. Returns empty object if file doesn't exist.
 */
export async function readDefaults(): Promise<Defaults> {
  const path = getDefaultsPath();

  if (!existsSync(path)) {
    return {};
  }

  const content = await readFile(path, 'utf-8');
  const parsed = yaml.load(content);

  if (parsed === null || parsed === undefined) {
    return {};
  }

  return parsed as Defaults;
}

/**
 * Write defaults.yaml with last-used-wins merge strategy.
 * Merges the provided partial into existing defaults.
 */
export async function writeDefaults(partial: Partial<Defaults>): Promise<void> {
  const current = await readDefaults();

  const merged: Defaults = {
    ...current,
    ...partial,
    thresholds: {
      ...current.thresholds,
      ...partial.thresholds,
    },
  };

  // Remove undefined keys from thresholds
  if (merged.thresholds && Object.keys(merged.thresholds).length === 0) {
    delete merged.thresholds;
  }

  const content = yaml.dump(merged, { lineWidth: -1, noRefs: true });
  await writeFile(getDefaultsPath(), content, 'utf-8');
}
