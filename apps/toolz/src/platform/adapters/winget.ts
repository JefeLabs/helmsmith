/**
 * Winget adapter — Windows Package Manager. Ships with modern
 * Windows 10/11. UAC elevation is handled by Windows itself
 * (a dialog appears) — no sudo concept here.
 *
 * Winget IDs are typically vendor-prefixed (e.g. "Git.Git",
 * "GitHub.cli"). The catalog (Phase 4) maps canonical tool names to
 * these IDs. Adapter takes the literal ID.
 */

import type { PackageManagerAdapter, InstallResult } from "../package-managers.js";
import { commandExists, runCommand } from "./exec.js";

let availabilityCache: boolean | undefined;

export const wingetAdapter: PackageManagerAdapter = {
  name: "winget",

  async isAvailable(): Promise<boolean> {
    if (availabilityCache !== undefined) return availabilityCache;
    availabilityCache = await commandExists("winget");
    return availabilityCache;
  },

  async install(packageName: string): Promise<InstallResult> {
    return runCommand("winget", [
      "install",
      "--exact",
      "--id",
      packageName,
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
  },

  async uninstall(packageName: string): Promise<InstallResult> {
    return runCommand("winget", [
      "uninstall",
      "--exact",
      "--id",
      packageName,
      "--silent",
    ]);
  },

  async isPackageInstalled(packageName: string): Promise<boolean> {
    // `winget list --id <id>` exits 0 with the package row when
    // installed, non-zero otherwise.
    const result = await runCommand("winget", [
      "list",
      "--exact",
      "--id",
      packageName,
    ]);
    return result.success && result.stdout.includes(packageName);
  },
};

/** For tests — clear the availability cache. */
export function _resetWingetCache(): void {
  availabilityCache = undefined;
}
