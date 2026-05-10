/**
 * Adapter registry + auto-selection. Given the current platform,
 * pick the right package manager for installs.
 *
 * Selection priority:
 *   1. Platform-native preferred manager (brew on darwin, apt on
 *      Debian-family, winget on Windows, etc.)
 *   2. Brew as a universal fallback on POSIX hosts (Linuxbrew exists)
 *   3. Fail with a clear error
 *
 * Adapters not yet implemented (dnf, pacman, apk, scoop, choco) are
 * intentionally absent from the registry. Hosts on those distros fall
 * through to the brew-fallback path; if brew isn't installed they get
 * a clear "no adapter available" error rather than a silent skip.
 */

import { detectPlatform } from '../detect.js';
import type { PackageManagerAdapter } from '../package-managers.js';
import type { PackageManagerType } from '../types.js';
import { aptAdapter } from './apt.js';
import { brewAdapter } from './brew.js';
import { wingetAdapter } from './winget.js';

/** All adapters currently implemented, keyed by their PackageManagerType. */
export const adapters: Partial<Record<PackageManagerType, PackageManagerAdapter>> = {
  brew: brewAdapter,
  apt: aptAdapter,
  winget: wingetAdapter,
};

export { aptAdapter, brewAdapter, wingetAdapter };

/**
 * Pick the best adapter for the current host. Returns null when none
 * of the implemented adapters is available — caller decides how to
 * fail (typically: print a guidance message naming what's missing).
 */
export async function selectAdapter(): Promise<PackageManagerAdapter | null> {
  const info = detectPlatform();
  const candidates = adapterCandidates(info.platform, info.linuxFamily);

  for (const adapter of candidates) {
    if (await adapter.isAvailable()) return adapter;
  }
  return null;
}

/**
 * Ordered list of adapters to try for the given platform. The first
 * available one wins. Order encodes preference — native package
 * manager for the distro family first, brew as the cross-platform
 * fallback last.
 */
function adapterCandidates(
  platform: string,
  linuxFamily: string | undefined,
): PackageManagerAdapter[] {
  if (platform === 'darwin') {
    return [brewAdapter];
  }
  if (platform === 'win32') {
    return [wingetAdapter];
  }
  if (platform === 'linux') {
    if (linuxFamily === 'debian') return [aptAdapter, brewAdapter];
    // Other Linux families: brew is the only working fallback today.
    return [brewAdapter];
  }
  return [];
}
