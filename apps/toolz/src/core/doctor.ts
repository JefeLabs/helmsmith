/**
 * Reconciliation pass for the registry. ensureTool trusts the registry
 * without re-probing for speed; doctor is the read-only counterpart
 * that validates every registered entry against the filesystem and
 * package manager state. Findings are returned as a flat list; the CLI
 * groups them for display.
 *
 * Checks per registered tool:
 *
 *   1. path-missing      — registered path doesn't exist on disk
 *   2. path-drift        — `which <tool>` resolves elsewhere
 *   3. version-drift     — re-probed version differs from registered
 *   4. pkg-removed       — installed_via set, manager says not installed
 *
 * Doctor never mutates state. A future Phase 7+ `--fix` mode could
 * apply suggested actions (re-register, deregister), but that's its
 * own design decision (which fixes are safe to auto-apply, which
 * require confirmation).
 */

import { existsSync } from "node:fs";
import { adapters } from "../platform/adapters/index.js";
import { listRegisteredTools } from "../config/registry.js";
import { checkTool, getPath } from "./tool-checker.js";
import { resolvePackageName } from "./tool-resolver.js";

export type DoctorSeverity = "error" | "warning" | "info";

export interface DoctorFinding {
  severity: DoctorSeverity;
  /** The registered tool name the finding applies to. */
  tool: string;
  /** Stable identifier for the kind of finding (for filtering / scripts). */
  code:
    | "path-missing"
    | "path-drift"
    | "version-drift"
    | "pkg-removed";
  /** Human-readable description. */
  message: string;
  /** Suggested next action (free-form). */
  fix?: string;
}

export async function runDoctor(): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];

  for (const { name, entry } of listRegisteredTools()) {
    // 1. Path still exists?
    if (!existsSync(entry.path)) {
      findings.push({
        severity: "error",
        tool: name,
        code: "path-missing",
        message: `Registered path doesn't exist: ${entry.path}`,
        fix: `Run 'toolz deregister ${name}' if uninstalled, or 'toolz register ${name}' if reinstalled elsewhere.`,
      });
      // No point checking the rest if the path is gone.
      continue;
    }

    // 2. Path drift — does `which <tool>` resolve elsewhere?
    const currentPath = await getPath(name);
    if (currentPath && currentPath !== entry.path) {
      findings.push({
        severity: "warning",
        tool: name,
        code: "path-drift",
        message: `PATH now resolves ${name} to ${currentPath} (registered: ${entry.path})`,
        fix: `Run 'toolz register ${name}' to refresh the registry entry.`,
      });
    }

    // 3. Version drift — re-probe and compare
    const probed = await checkTool(name);
    if (
      probed.version &&
      entry.version &&
      probed.version !== entry.version
    ) {
      findings.push({
        severity: "info",
        tool: name,
        code: "version-drift",
        message: `Version drifted: registered ${entry.version} → current ${probed.version}`,
        fix: `Run 'toolz register ${name}' to refresh.`,
      });
    }

    // 4. Package removed via manager outside ToolZ?
    if (entry.installed_via) {
      const adapter = adapters[entry.installed_via];
      if (adapter && (await adapter.isAvailable())) {
        const resolved = resolvePackageName(name, entry.installed_via);
        if (resolved) {
          const stillInstalled = await adapter.isPackageInstalled(
            resolved.packageName,
          );
          if (!stillInstalled) {
            findings.push({
              severity: "error",
              tool: name,
              code: "pkg-removed",
              message: `Registered as installed via ${entry.installed_via}, but ${entry.installed_via} reports ${resolved.packageName} is not installed.`,
              fix: `Run 'toolz deregister ${name}' to clear the stale entry, or reinstall via 'toolz install ${name}'.`,
            });
          }
        }
      }
    }
  }

  return findings;
}
