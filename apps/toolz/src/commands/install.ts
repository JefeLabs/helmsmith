import { selectAdapter } from "../platform/index.js";
import { checkTool, resolvePackageName } from "../core/index.js";
import { registerTool } from "../config/index.js";
import { fail, ok } from "../ui/index.js";

export interface InstallOptions {
  via?: string;
  dryRun?: boolean;
}

/**
 * Install a tool via the platform's package manager. Probes the
 * freshly-installed binary afterward and records it in the registry
 * so subsequent `toolz list` and `toolz check` see consistent state.
 */
export async function runInstall(
  tool: string,
  options: InstallOptions = {},
): Promise<void> {
  const adapter = options.via
    ? (await import("../platform/adapters/index.js")).adapters[
        options.via as never
      ] ?? null
    : await selectAdapter();

  if (!adapter) {
    console.error(
      `✗ No package manager available on this host. ` +
        `On macOS install Homebrew (https://brew.sh); on Debian/Ubuntu apt is preinstalled; ` +
        `on Windows install winget.`,
    );
    process.exit(1);
  }

  const resolved = resolvePackageName(tool, adapter.name);
  if (!resolved) {
    console.error(
      `✗ ${tool} is not in the catalog, or has no entry for ${adapter.name}. ` +
        `Run 'toolz catalog' to see known tools.`,
    );
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`[dry-run] would install via ${adapter.name}:`);
    console.log(`  ${tool} → ${resolved.packageName}`);
    return;
  }

  console.log(`Installing ${tool} via ${adapter.name} (${resolved.packageName})...`);
  const result = await adapter.install(resolved.packageName);
  if (!result.success) {
    console.error(fail(`Install failed: ${result.error ?? "unknown error"}`));
    if (result.stderr) console.error(result.stderr);
    process.exit(1);
  }
  console.log(ok(`Installed ${tool}`));
  if (result.stdout.trim()) console.log(result.stdout.trim());

  const check = await checkTool(tool);
  if (check.installed) {
    registerTool(tool, {
      version: check.version,
      path: check.path!,
      installed_via: adapter.name,
      installed_at: new Date().toISOString(),
    });
  }
}
