import type { Manifest } from './types.js';

/** Slot N's port for every service: base + N. */
export function portsForSlot(m: Manifest, slot: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(m.ports.services).map(([service, { base }]) => [service, base + slot]),
  );
}
