/**
 * ToolZ CLI entry. Commander.js per agentx-toolbox stack convention.
 * Phase 1+2 surface area: `platform`, `check`. More commands land in
 * later phases (install, list, register, doctor, etc.).
 */

import { Command } from "commander";
import { detectPlatform, selectAdapter } from "./platform/index.js";
import {
  BUILT_IN_CATALOG,
  catalogToolNames,
  checkTool,
  resolvePackageName,
} from "./core/index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersion(): string {
  // Walk up from the compiled cli.js (in dist/) to find package.json.
  for (let dir = __dirname, i = 0; i < 4; i++, dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === "@agentx/toolz") return pkg.version as string;
    } catch {
      /* keep walking */
    }
  }
  return "0.0.0";
}

const program = new Command();

program
  .name("toolz")
  .description("ToolZ — cross-platform tool manager for AgentX")
  .version(readVersion());

program
  .command("platform")
  .description("Show the detected OS, architecture, distro family, and WSL state")
  .action(() => {
    const info = detectPlatform();
    console.log(JSON.stringify(info, null, 2));
  });

program
  .command("check <tool>")
  .description("Check whether a CLI tool is installed; show its path and parsed version")
  .option("--version-flag <flag>", "Override the default `--version` flag")
  .action(
    async (
      tool: string,
      options: { versionFlag?: string },
    ) => {
      const result = await checkTool(tool, {
        ...(options.versionFlag ? { versionFlag: options.versionFlag } : {}),
      });
      if (!result.installed) {
        console.log(`✗ ${tool} — not installed`);
        process.exit(1);
      }
      console.log(`✓ ${tool}`);
      console.log(`  path:    ${result.path}`);
      console.log(`  version: ${result.version ?? "(unparseable)"}`);
    },
  );

program
  .command("install <tool>")
  .description("Install a tool via the platform's package manager")
  .option("--via <manager>", "Force a specific package manager (brew, apt, winget)")
  .option("--dry-run", "Print the command that would run; don't execute")
  .action(
    async (
      tool: string,
      options: { via?: string; dryRun?: boolean },
    ) => {
      const adapter = options.via
        ? (await import("./platform/adapters/index.js")).adapters[
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
        console.error(`✗ Install failed: ${result.error ?? "unknown error"}`);
        if (result.stderr) console.error(result.stderr);
        process.exit(1);
      }
      console.log(`✓ Installed ${tool}`);
      if (result.stdout.trim()) console.log(result.stdout.trim());
    },
  );

program
  .command("uninstall <tool>")
  .description("Uninstall a tool via the platform's package manager")
  .option("--via <manager>", "Force a specific package manager")
  .action(
    async (tool: string, options: { via?: string }) => {
      const adapter = options.via
        ? (await import("./platform/adapters/index.js")).adapters[
            options.via as never
          ] ?? null
        : await selectAdapter();

      if (!adapter) {
        console.error(`✗ No package manager available.`);
        process.exit(1);
      }
      const resolved = resolvePackageName(tool, adapter.name);
      if (!resolved) {
        console.error(`✗ ${tool} is not in the catalog for ${adapter.name}.`);
        process.exit(1);
      }
      console.log(`Uninstalling ${tool} via ${adapter.name}...`);
      const result = await adapter.uninstall(resolved.packageName);
      if (!result.success) {
        console.error(`✗ Uninstall failed: ${result.error ?? "unknown error"}`);
        process.exit(1);
      }
      console.log(`✓ Uninstalled ${tool}`);
    },
  );

program
  .command("catalog")
  .description("List every canonical tool name known to the built-in catalog")
  .action(() => {
    const names = catalogToolNames();
    console.log(`Built-in catalog (${names.length} tools):\n`);
    for (const name of names) {
      const entry = BUILT_IN_CATALOG[name];
      console.log(`  ${name.padEnd(12)} — ${entry.description}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
