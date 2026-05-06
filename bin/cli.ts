#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import {
  getCommand,
  getCommands,
  getSkill,
  getSkills,
  getWorkflow,
  getWorkflows,
  loadCatalog,
} from "../lib/index.js";
import { resolveInstallPlan } from "../lib/resolve.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find the package root by walking up looking for `catalog.json`. Handles
 * both layouts: `dist/bin/cli.js` (published) and `bin/cli.ts` (dev via
 * tsx). Mirrors the same trick used by `findCatalogPath` in lib/index.ts.
 */
function findPackageRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "catalog.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `skillzkit package root not found searching upward from ${__dirname}`
  );
}

const packageRoot = findPackageRoot();

const cli = cac("skillzkit");

interface ListOptions {
  commands?: boolean;
  skills?: boolean;
  workflows?: boolean;
  kind?: "command" | "workflow" | "context";
}
interface InstallOptions {
  target?: string;
  force?: boolean;
  dryRun?: boolean;
}
interface UiOptions {
  target?: string;
}

cli
  .command("list", "List commands, skills, and workflows in the catalog")
  .option("--commands", "Show only commands")
  .option("--skills", "Show only skills")
  .option("--workflows", "Show only workflows")
  .option("--kind <kind>", "Filter commands by kind: command|workflow|context")
  .action((options: ListOptions) => {
    const showAll = !options.commands && !options.skills && !options.workflows;

    if (showAll || options.commands) {
      const commands = getCommands().filter((c) =>
        options.kind ? c.kind === options.kind : c.kind === "command"
      );
      console.log(`\n=== Commands (${commands.length}) ===`);
      for (const cmd of commands) {
        console.log(`  /${cmd.slug}  —  ${truncate(cmd.description, 80)}`);
      }
    }

    if (showAll || options.workflows) {
      const workflows = getWorkflows();
      console.log(`\n=== Workflows (${workflows.length}) ===`);
      for (const wf of workflows) {
        const dur = wf.estimatedDuration ? ` (${wf.estimatedDuration})` : "";
        console.log(`  ${wf.qualifiedName}${dur}  —  ${truncate(wf.description, 80)}`);
      }
    }

    if (showAll || options.skills) {
      const skills = getSkills();
      console.log(`\n=== Skills (${skills.length}) ===`);
      for (const skill of skills) {
        console.log(`  ${skill.name}  —  ${truncate(skill.description, 80)}`);
      }
    }
  });

cli
  .command("show <slug>", "Print one command, skill, or workflow body by slug or name")
  .action((slug: string) => {
    const cmd = getCommand(slug);
    if (cmd) {
      printItem("command", cmd.slug, cmd.description, cmd.body);
      return;
    }
    const skill = getSkill(slug);
    if (skill) {
      printItem("skill", skill.name, skill.description, skill.body);
      return;
    }
    const wf = getWorkflow(slug);
    if (wf) {
      printItem("workflow", wf.qualifiedName, wf.description, wf.body);
      return;
    }
    console.error(`Not found: ${slug}`);
    process.exit(1);
  });

cli
  .command("ui", "Launch the interactive installer (requires bundled Bun runtime)")
  .option("--target <path>", "Target directory (default: current working directory)")
  .action((options: UiOptions) => {
    launchTui(options.target ?? process.cwd());
  });

cli
  .command(
    "install [...slugs]",
    "Install all catalog items (no args), OR specific items + transitive deps when slugs given"
  )
  .option("--target <path>", "Target directory (default: current working directory)")
  .option("--force", "Overwrite existing files in the target")
  .option("--dry-run", "Print the resolved install plan without copying files")
  .action((slugs: string[], options: InstallOptions) => {
    const target = options.target ? options.target : process.cwd();
    const targetClaude = join(target, ".claude");

    // No slugs → original blanket-install behavior (commands + skills wholesale).
    // SKILLs (routers) and commands both ship into the standard .claude/ tree.
    if (!slugs || slugs.length === 0) {
      const targetCore = join(targetClaude, "commands", "core");
      if (existsSync(targetCore) && !options.force) {
        console.error(
          `Refusing to install: ${targetCore} already exists. Use --force to overwrite, ` +
            `or pass specific slugs to install just those + their dependencies.`
        );
        process.exit(1);
      }
      const sourceCommands = join(packageRoot, ".claude", "commands");
      const sourceSkills = join(packageRoot, ".claude", "skills");
      copyDir(sourceCommands, join(targetClaude, "commands"));
      copyDir(sourceSkills, join(targetClaude, "skills"));
      console.log(`✓ Installed (blanket) to ${targetClaude}`);
      console.log("");
      console.log("Next steps:");
      console.log("  /core:tools:setup           — install/verify local tools");
      console.log("  /core:integrations:setup    — configure remote services");
      console.log("  /core:frameworks:init       — detect framework bindings");
      console.log("  /core:workflows:_index      — see the workflow decision tree");
      return;
    }

    // Selective install: walk references[] for transitive deps.
    const { plan, missing } = resolveInstallPlan(slugs);

    if (missing.length > 0) {
      console.error(`✗ Unknown slugs (${missing.length}):`);
      for (const m of missing) console.error(`    ${m}`);
      console.error("");
      console.error(`Run 'skillzkit list' to see all available items.`);
      process.exit(1);
    }

    if (plan.length === 0) {
      console.error(`✗ Nothing to install (no slugs resolved).`);
      process.exit(1);
    }

    if (options.dryRun) {
      console.log(`Install plan (${plan.length} items, ${slugs.length} requested):`);
      for (const item of plan) {
        const trace = item.requestedBy ? `   ← via ${item.requestedBy}` : "   (requested)";
        console.log(`  [${item.kind.padEnd(8)}] ${item.slug}${trace}`);
      }
      console.log("");
      console.log("Re-run without --dry-run to actually copy files.");
      return;
    }

    let written = 0;
    let skipped = 0;
    for (const item of plan) {
      const subdir = item.kind === "skill" ? "skills" : "commands";
      const sourcePath = join(packageRoot, ".claude", subdir, item.path);
      const destPath = join(targetClaude, subdir, item.path);

      if (existsSync(destPath) && !options.force) {
        skipped++;
        continue;
      }
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(sourcePath, destPath);
      written++;
    }

    console.log(`✓ Installed ${written} item(s) to ${targetClaude}`);
    if (skipped > 0) {
      console.log(`  (${skipped} skipped — already exist; pass --force to overwrite)`);
    }
    console.log("");
    console.log("Requested:");
    for (const slug of slugs) console.log(`  - ${slug}`);
    if (plan.length > slugs.length) {
      console.log("");
      console.log(`Plus ${plan.length - slugs.length} transitive dep(s).`);
    }
  });

cli
  .command("version", "Print the package version")
  .action(() => {
    const catalog = loadCatalog();
    console.log(catalog.packageVersion);
  });

cli.help();
cli.version("0.1.0");

cli.parse();

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function printItem(kind: string, identifier: string, description: string, body: string) {
  console.log(`# ${kind}: ${identifier}`);
  console.log("");
  console.log(`> ${description}`);
  console.log("");
  console.log("---");
  console.log("");
  console.log(body);
}

/**
 * Launch the TUI by spawning the bundled Bun binary on the TUI entry.
 * Bun is required because @opentui/core uses Bun-native FFI; it does not
 * load under Node's ESM loader.
 */
function launchTui(targetDir: string) {
  const requireFromHere = createRequire(import.meta.url);
  const bunPkgJsonPath = requireFromHere.resolve("bun/package.json");
  const bunPkg = JSON.parse(readFileSync(bunPkgJsonPath, "utf8"));
  const bunBinRel = typeof bunPkg.bin === "string" ? bunPkg.bin : bunPkg.bin?.bun;
  if (!bunBinRel) {
    console.error("Could not resolve bundled Bun binary from package.json bin field.");
    process.exit(1);
  }
  const bunBin = join(dirname(bunPkgJsonPath), bunBinRel);
  const tuiEntry = join(packageRoot, "tui", "main.tsx");

  if (!existsSync(tuiEntry)) {
    console.error(`TUI entry not found at ${tuiEntry}. Did you forget to ship the tui/ directory?`);
    process.exit(1);
  }
  if (!existsSync(bunBin)) {
    console.error(`Bundled Bun binary not found at ${bunBin}.`);
    process.exit(1);
  }

  const result = spawnSync(bunBin, [tuiEntry], {
    stdio: "inherit",
    env: { ...process.env, SKILLZKIT_TARGET: targetDir },
  });
  process.exit(result.status ?? 1);
}

function copyDir(source: string, dest: string) {
  if (!existsSync(source)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source)) {
    const srcPath = join(source, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (stat.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}
