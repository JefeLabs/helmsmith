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
  ensureTool,
  ensureTools,
  resolvePackageName,
} from "./core/index.js";
import {
  getRegisteredTool,
  isRegistered,
  listRegisteredTools,
  registerTool,
  unregisterTool,
} from "./config/index.js";
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

      // Probe the freshly-installed binary and record it in the
      // registry so subsequent `toolz list` and `toolz check` calls
      // see consistent state.
      const check = await checkTool(tool);
      if (check.installed) {
        registerTool(tool, {
          version: check.version,
          path: check.path!,
          installed_via: adapter.name,
          installed_at: new Date().toISOString(),
        });
      }
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
      unregisterTool(tool);
    },
  );

program
  .command("list")
  .description("List tools registered in the local registry")
  .option("--catalog", "List every tool in the built-in catalog instead")
  .action((options: { catalog?: boolean }) => {
    if (options.catalog) {
      const names = catalogToolNames();
      console.log(`Catalog (${names.length} tools):\n`);
      for (const name of names) {
        const entry = BUILT_IN_CATALOG[name];
        const desc = entry?.description ?? "(no description)";
        console.log(`  ${name.padEnd(12)} — ${desc}`);
      }
      return;
    }
    const registered = listRegisteredTools();
    if (registered.length === 0) {
      console.log("No tools registered. Run `toolz install <tool>` or `toolz register <tool>`.");
      return;
    }
    console.log(`Registered tools (${registered.length}):\n`);
    for (const { name, entry } of registered) {
      const via = entry.installed_via ? ` via ${entry.installed_via}` : " (manual)";
      const ver = entry.version ?? "?";
      console.log(`  ${name.padEnd(12)} ${ver.padEnd(10)} ${entry.path}${via}`);
    }
  });

program
  .command("register <tool>")
  .description("Register an already-installed tool in the local registry")
  .action(async (tool: string) => {
    const check = await checkTool(tool);
    if (!check.installed) {
      console.error(`✗ ${tool} is not on PATH. Install it first, then register.`);
      process.exit(1);
    }
    registerTool(tool, {
      version: check.version,
      path: check.path!,
      installed_via: null, // manually registered
      installed_at: null, // unknown — we didn't install it
    });
    console.log(`✓ Registered ${tool} ${check.version ?? ""} at ${check.path}`);
  });

program
  .command("deregister <tool>")
  .description("Remove a tool from the registry (does NOT uninstall)")
  .action((tool: string) => {
    if (!isRegistered(tool)) {
      console.error(`✗ ${tool} is not registered.`);
      process.exit(1);
    }
    unregisterTool(tool);
    console.log(`✓ Deregistered ${tool}`);
  });

program
  .command("ensure <tools...>")
  .description("Ensure one or more tools are installed; install missing ones if --auto-install")
  .option("--min-version <version>", "Minimum acceptable semver (single tool only)")
  .option("--auto-install", "Install missing tools automatically (default: report and exit non-zero)")
  .option("--silent", "Suppress progress logs (errors still print)")
  .option("--via <manager>", "Force a specific package manager")
  .action(
    async (
      tools: string[],
      options: {
        minVersion?: string;
        autoInstall?: boolean;
        silent?: boolean;
        via?: string;
      },
    ) => {
      const opts = {
        ...(options.minVersion ? { minVersion: options.minVersion } : {}),
        ...(options.autoInstall !== undefined
          ? { autoInstall: options.autoInstall }
          : {}),
        ...(options.silent !== undefined ? { silent: options.silent } : {}),
        ...(options.via ? { via: options.via as never } : {}),
      };

      const statuses =
        tools.length === 1
          ? [await ensureTool(tools[0], opts)]
          : await ensureTools(tools, opts);

      let anyMissing = false;
      let anyStale = false;
      for (const status of statuses) {
        if (status.error) {
          console.error(`✗ ${status.name}: ${status.error}`);
          anyMissing = true;
          continue;
        }
        if (!status.installed) {
          console.error(
            `✗ ${status.name}: not installed${
              opts.autoInstall ? " (install also failed)" : "; pass --auto-install to attempt install"
            }`,
          );
          anyMissing = true;
          continue;
        }
        if (status.versionTooLow) {
          console.error(
            `⚠ ${status.name} ${status.version ?? "(unknown)"}: below minVersion ${opts.minVersion}`,
          );
          anyStale = true;
          continue;
        }
        if (!options.silent) {
          console.log(
            `✓ ${status.name} ${status.version ?? ""} (${status.source})`,
          );
        }
      }

      if (anyMissing || anyStale) process.exit(1);
    },
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
