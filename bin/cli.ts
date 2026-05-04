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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..", "..");

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
  .command("install", "Copy .claude/commands and .claude/skills into the target project")
  .option("--target <path>", "Target directory (default: current working directory)")
  .option("--force", "Overwrite even if target .claude/commands/core already exists")
  .action((options: InstallOptions) => {
    const target = options.target ? options.target : process.cwd();
    const targetClaude = join(target, ".claude");
    const targetCore = join(targetClaude, "commands", "core");

    if (existsSync(targetCore) && !options.force) {
      console.error(
        `Refusing to install: ${targetCore} already exists. Use --force to overwrite.`
      );
      process.exit(1);
    }

    const sourceCommands = join(packageRoot, ".claude", "commands");
    const sourceSkills = join(packageRoot, ".claude", "skills");
    const targetCommands = join(targetClaude, "commands");
    const targetSkills = join(targetClaude, "skills");

    copyDir(sourceCommands, targetCommands);
    copyDir(sourceSkills, targetSkills);

    console.log(`✓ Installed to ${targetClaude}`);
    console.log("");
    console.log("Next steps:");
    console.log("  /core:tools:setup           — install/verify local tools");
    console.log("  /core:integrations:setup    — configure remote services");
    console.log("  /core:frameworks:init       — detect framework bindings");
    console.log("  /core:workflows:_index      — see the workflow decision tree");
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
