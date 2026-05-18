/**
 * Framework registry — the only place that knows the concrete
 * adapters. Commands resolve a `--framework <id>` through here and
 * never import an adapter module directly, so adding a framework is a
 * one-line change confined to this file.
 */

import type { FrameworkAdapter } from './adapter.ts';
import { heroUIAdapter } from '../heroui/index.ts';
import { heroUIProAdapter } from '../heroui-pro/index.ts';

const ADAPTERS: FrameworkAdapter[] = [heroUIAdapter, heroUIProAdapter];

const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

export const DEFAULT_FRAMEWORK = heroUIAdapter.id;

export function listFrameworks(): FrameworkAdapter[] {
  return [...ADAPTERS];
}

export function getFramework(id: string): FrameworkAdapter {
  const adapter = BY_ID.get(id);
  if (!adapter) {
    const known = ADAPTERS.map((a) => a.id).join(', ');
    throw new Error(`mech-pencil: unknown framework "${id}". Known: ${known}`);
  }
  return adapter;
}
