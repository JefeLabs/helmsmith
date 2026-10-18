import { WorkkitError } from './errors.js';
import type { Registry } from './registry.js';
import type { Manifest } from './types.js';

export interface PortRange {
  base: number;
  count: number;
}

/** Slot N's port for every service: base + N. */
export function portsForSlot(m: Manifest, slot: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(m.ports.services).map(([service, { base }]) => [service, base + slot]),
  );
}

/** The ports a project claims: one range [base, base + slots.count) per service. */
export function rangesFor(m: Manifest): Record<string, PortRange> {
  return Object.fromEntries(
    Object.entries(m.ports.services).map(([service, { base }]) => [
      service,
      { base, count: m.slots.count },
    ]),
  );
}

export function rangesOverlap(a: PortRange, b: PortRange): boolean {
  return a.base < b.base + b.count && b.base < a.base + a.count;
}

/**
 * Record the project's ranges in the registry. Idempotent for the same project; refuses when
 * another project already holds an overlapping range, naming it and the service.
 */
/**
 * Every command: refuse when this project's ranges overlap another project's, and
 * (re-)register them when the manifest's ranges differ from what the registry holds.
 */
export function ensureRanges(registry: Registry, m: Manifest, repoRoot: string): void {
  const mine = rangesFor(m);
  assertNoOverlap(registry, m, mine);
  const current = registry.project(m.project);
  if (current && JSON.stringify(current.ranges) === JSON.stringify(mine)) return;
  registry.upsertProject(m.project, { root: repoRoot, ranges: mine });
}

export function claimRanges(registry: Registry, m: Manifest, repoRoot: string): void {
  const mine = rangesFor(m);
  assertNoOverlap(registry, m, mine);
  registry.upsertProject(m.project, { root: repoRoot, ranges: mine });
}

function assertNoOverlap(
  registry: Registry,
  m: Manifest,
  mine: ReturnType<typeof rangesFor>,
): void {
  const others = Object.entries(registry.read().projects).filter(([name]) => name !== m.project);
  for (const [service, range] of Object.entries(mine)) {
    for (const [name, entry] of others) {
      for (const [theirService, theirs] of Object.entries(entry.ranges)) {
        if (rangesOverlap(range, theirs)) {
          throw new WorkkitError(
            'PORT_RANGE_TAKEN',
            `ports ${range.base}-${range.base + range.count - 1} for "${service}" overlap project "${name}" (${theirService}: ${theirs.base}-${theirs.base + theirs.count - 1}); pick another base in ports.services.${service}`,
            { project: name, service, theirs },
          );
        }
      }
    }
  }
}
