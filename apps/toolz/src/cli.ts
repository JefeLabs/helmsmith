/**
 * ToolZ CLI entry. Commander.js per agentx-toolbox stack convention.
 * Phase 1-7 surface: platform, check, install, uninstall, list,
 * register, deregister, ensure, doctor.
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
  runDoctor,
} from "./core/index.js";
import {
  isRegistered,
  listRegisteredTools,
  registerTool,
  unregisterTool,
} from "./config/index.js";
import { dim, fail, heading, info, ok, printBanner, warn } from "./ui/index.js";
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
        console.log(fail(`${tool} — not installed`));
        process.exit(1);
      }
      console.log(ok(tool));
      console.log(dim(`  path:    ${result.path}`));
      console.log(dim(`  version: ${result.version ?? "(unparseable)"}`));
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
        console.error(fail(`Install failed: ${result.error ?? "unknown error"}`));
        if (result.stderr) console.error(result.stderr);
        process.exit(1);
      }
      console.log(ok(`Installed ${tool}`));
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
        console.error(fail(`Uninstall failed: ${result.error ?? "unknown error"}`));
        process.exit(1);
      }
      console.log(ok(`Uninstalled ${tool}`));
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
      console.log(heading(`Catalog (${names.length} tools)`));
      console.log("");
      for (const name of names) {
        const entry = BUILT_IN_CATALOG[name];
        const desc = entry?.description ?? "(no description)";
        console.log(`  ${name.padEnd(12)} ${dim(`— ${desc}`)}`);
      }
      return;
    }
    const registered = listRegisteredTools();
    if (registered.length === 0) {
      console.log(dim("No tools registered. Run `toolz install <tool>` or `toolz register <tool>`."));
      return;
    }
    console.log(heading(`Registered tools (${registered.length})`));
    console.log("");
    for (const { name, entry } of registered) {
      const via = entry.installed_via ? ` via ${entry.installed_via}` : " (manual)";
      const ver = entry.version ?? "?";
      console.log(`  ${name.padEnd(12)} ${ver.padEnd(10)} ${dim(entry.path + via)}`);
    }
  });

program
  .command("register <tool>")
  .description("Register an already-installed tool in the local registry")
  .action(async (tool: string) => {
    const check = await checkTool(tool);
    if (!check.installed) {
      console.error(fail(`${tool} is not on PATH. Install it first, then register.`));
      process.exit(1);
    }
    registerTool(tool, {
      version: check.version,
      path: check.path!,
      installed_via: null, // manually registered
      installed_at: null, // unknown — we didn't install it
    });
    console.log(ok(`Registered ${tool} ${check.version ?? ""} at ${check.path}`));
  });

program
  .command("deregister <tool>")
  .description("Remove a tool from the registry (does NOT uninstall)")
  .action((tool: string) => {
    if (!isRegistered(tool)) {
      console.error(fail(`${tool} is not registered.`));
      process.exit(1);
    }
    unregisterTool(tool);
    console.log(ok(`Deregistered ${tool}`));
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
          console.error(fail(`${status.name}: ${status.error}`));
          anyMissing = true;
          continue;
        }
        if (!status.installed) {
          console.error(
            fail(
              `${status.name}: not installed${
                opts.autoInstall ? " (install also failed)" : "; pass --auto-install to attempt install"
              }`,
            ),
          );
          anyMissing = true;
          continue;
        }
        if (status.versionTooLow) {
          console.error(
            warn(
              `${status.name} ${status.version ?? "(unknown)"}: below minVersion ${opts.minVersion}`,
            ),
          );
          anyStale = true;
          continue;
        }
        if (!options.silent) {
          console.log(
            ok(`${status.name} ${status.version ?? ""} ${dim(`(${status.source})`)}`),
          );
        }
      }

      if (anyMissing || anyStale) process.exit(1);
    },
  );

program
  .command("doctor")
  .description("Validate the registry against reality — detects stale paths, version drift, removed packages")
  .option("--errors-only", "Show only error-severity findings")
  .option("--json", "Emit findings as JSON for scripting")
  .action(async (options: { errorsOnly?: boolean; json?: boolean }) => {
    const findings = await runDoctor();
    const filtered = options.errorsOnly
      ? findings.filter((f) => f.severity === "error")
      : findings;

    if (options.json) {
      console.log(JSON.stringify(filtered, null, 2));
      if (findings.some((f) => f.severity === "error")) process.exit(1);
      return;
    }

    if (filtered.length === 0) {
      console.log(ok("No issues found."));
      return;
    }

    const counts = {
      error: findings.filter((f) => f.severity === "error").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
    };

    for (const severity of ["error", "warning", "info"] as const) {
      const subset = filtered.filter((f) => f.severity === severity);
      if (subset.length === 0) continue;
      const styled =
        severity === "error"
          ? fail(`${severity.toUpperCase()} (${subset.length})`)
          : severity === "warning"
            ? warn(`${severity.toUpperCase()} (${subset.length})`)
            : info(`${severity.toUpperCase()} (${subset.length})`);
      console.log(`\n${styled}`);
      for (const f of subset) {
        console.log(`  ${f.tool} ${dim(`[${f.code}]`)}`);
        console.log(`    ${f.message}`);
        if (f.fix) console.log(dim(`    → ${f.fix}`));
      }
    }

    console.log(
      `\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`,
    );
    if (counts.error > 0) process.exit(1);
  });

// Bare invocation (no subcommand, no --help, no --version) → branded
// banner + command hints. Commander's default is silent; this gives
// users a friendlier landing.
if (process.argv.length <= 2) {
  printBanner(readVersion());
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
