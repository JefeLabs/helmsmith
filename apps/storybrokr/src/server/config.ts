import { existsSync, readFileSync } from 'node:fs';
import { StorybrokrError } from '../lib/errors.js';
import { configFile } from '../lib/paths.js';
import type { DaemonConfig } from '../types.js';

export const DEFAULT_CONFIG: DaemonConfig = {
  ttlMinutes: 30,
  instanceCap: 6,
  portRangeStart: 6100,
  portRangeEnd: 6199,
  readinessTimeoutMs: 120_000,
  reaperIntervalMs: 60_000,
  autoStartWaitMs: 10_000,
};

const KEYS = Object.keys(DEFAULT_CONFIG) as (keyof DaemonConfig)[];

/** Defaults overlaid with any numeric keys found in <home>/config.json. */
export function loadConfig(home: string): DaemonConfig {
  const file = configFile(home);
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const out: DaemonConfig = { ...DEFAULT_CONFIG };
  for (const key of KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new StorybrokrError(
        'INTERNAL',
        `config.json: ${key} must be a number, got ${JSON.stringify(value)}`,
      );
    }
    out[key] = value;
  }
  return out;
}
