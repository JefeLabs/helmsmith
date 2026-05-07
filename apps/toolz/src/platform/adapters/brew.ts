/**
 * Homebrew adapter — macOS (and Linuxbrew on Linux when present).
 * No sudo needed (brew refuses to run as root on macOS by design).
 */

import type { PackageManagerAdapter, InstallResult } from "../package-managers.js";
import { commandExists, runCommand } from "./exec.js";

let availabilityCache: boolean | undefined;

export const brewAdapter: PackageManagerAdapter = {
  name: "brew",

  async isAvailable(): Promise<boolean> {
    if (availabilityCache !== undefined) return availabilityCache;
    availabilityCache = await commandExists("brew");
    return availabilityCache;
  },

  async install(packageName: string): Promise<InstallResult> {
    return runCommand("brew", ["install", packageName]);
  },

  async uninstall(packageName: string): Promise<InstallResult> {
    return runCommand("brew", ["uninstall", packageName]);
  },

  async isPackageInstalled(packageName: string): Promise<boolean> {
    // `brew list <name>` exits 0 if installed, non-zero if not.
    const result = await runCommand("brew", ["list", "--versions", packageName]);
    return result.success && result.stdout.trim().length > 0;
  },
};

/** For tests — clear the availability cache. */
export function _resetBrewCache(): void {
  availabilityCache = undefined;
}
