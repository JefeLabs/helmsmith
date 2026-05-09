#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
import {
  expandGroupIds,
  resolveInstallPlan,
  type ResolvedItem,
} from "../lib/resolve.js";
import { installSlugs } from "../lib/install.js";
import { runDoctor } from "../lib/doctor.js";
import { suggestNext, type ActiveWorkflowState } from "../lib/suggest.js";
import { collectTagCounts, loadCoreTags } from "../lib/tags.js";
import { runInit, type InitOptions } from "../lib/init/init.js";
import { closePrompts, prompt, promptHidden } from "../lib/init/prompt.js";
import {
  configExists,
  configPath,
  readConfig,
  writeConfig,
  type SkillzkitConfig,
} from "../lib/init/config.js";

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
  tree?: boolean;
  tag?: string;
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
  .option("--tree", "Render commands hierarchically by slug namespace")
  .option(
    "--tag <name>",
    "Filter to artifacts carrying this tag (cross-persona discovery)",
  )
  .action((options: ListOptions) => {
    if (options.tree) {
      console.log(renderTreeView());
      return;
    }

    const showAll = !options.commands && !options.skills && !options.workflows;
    const hasTag = (tags: string[] | undefined) =>
      !options.tag || (tags ?? []).includes(options.tag);

    if (showAll || options.commands) {
      const commands = getCommands().filter(
        (c) =>
          (options.kind ? c.kind === options.kind : c.kind === "command") &&
          hasTag(c.tags),
      );
      console.log(`\n=== Commands (${commands.length}) ===`);
      for (const cmd of commands) {
        console.log(`  /${cmd.slug}  —  ${truncate(cmd.description, 80)}`);
      }
    }

    if (showAll || options.workflows) {
      const workflows = getWorkflows().filter((w) => hasTag(w.tags));
      console.log(`\n=== Workflows (${workflows.length}) ===`);
      for (const wf of workflows) {
        const dur = wf.estimatedDuration ? ` (${wf.estimatedDuration})` : "";
        console.log(`  ${wf.qualifiedName}${dur}  —  ${truncate(wf.description, 80)}`);
      }
    }

    if (showAll || options.skills) {
      const skills = getSkills().filter((s) => hasTag(s.tags));
      console.log(`\n=== Skills (${skills.length}) ===`);
      for (const skill of skills) {
        console.log(`  ${skill.name}  —  ${truncate(skill.description, 80)}`);
      }
    }
  });

cli
  .command(
    "search <query>",
    "Find commands, workflows, and skills whose slug or description matches",
  )
  .option("--limit <n>", "Maximum results per kind (default 10)")
  .action((query: string, options: { limit?: string }) => {
    const limit = options.limit ? Number.parseInt(options.limit, 10) : 10;
    const q = query.toLowerCase();
    const matches = (haystack: string) => haystack.toLowerCase().includes(q);
    // Tags are an additional search axis — searching for "accessibility"
    // surfaces artifacts tagged accessibility regardless of where they
    // live in the persona tree, complementing slug/description matches.
    const matchesAnyTag = (tags: string[] | undefined) =>
      (tags ?? []).some(matches);

    const cmds = getCommands().filter(
      (c) =>
        c.kind === "command" &&
        (matches(c.slug) || matches(c.description) || matchesAnyTag(c.tags)),
    );
    const wfs = getWorkflows().filter(
      (w) =>
        matches(w.qualifiedName) ||
        matches(w.description) ||
        matchesAnyTag(w.tags),
    );
    const skls = getSkills().filter(
      (s) =>
        matches(s.name) || matches(s.description) || matchesAnyTag(s.tags),
    );

    if (cmds.length + wfs.length + skls.length === 0) {
      console.log(`No matches for "${query}".`);
      return;
    }

    if (cmds.length > 0) {
      console.log(`\nCommands (${cmds.length}${cmds.length > limit ? `, showing ${limit}` : ""})`);
      for (const c of cmds.slice(0, limit)) {
        console.log(`  /${c.slug}  —  ${truncate(c.description, 80)}`);
      }
    }
    if (wfs.length > 0) {
      console.log(`\nWorkflows (${wfs.length}${wfs.length > limit ? `, showing ${limit}` : ""})`);
      for (const w of wfs.slice(0, limit)) {
        console.log(`  ${w.qualifiedName}  —  ${truncate(w.description, 80)}`);
      }
    }
    if (skls.length > 0) {
      console.log(`\nSkills (${skls.length}${skls.length > limit ? `, showing ${limit}` : ""})`);
      for (const s of skls.slice(0, limit)) {
        console.log(`  ${s.name}  —  ${truncate(s.description, 80)}`);
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
  .command(
    "serve",
    "Run the skillzkit REST API locally (Bun-backed). Defaults to fs:auto storage against this repo.",
  )
  .option("--port <port>", "Listen port (default: 3000)")
  .option(
    "--storage <spec>",
    "Storage backend: memory | fs:<path> | fs-persistent:<path> | s3:<bucket> (default: fs:auto)",
  )
  .action((options: { port?: string; storage?: string }) => {
    const requireFromHere = createRequire(import.meta.url);
    const bunPkgJsonPath = requireFromHere.resolve("bun/package.json");
    const bunPkg = JSON.parse(readFileSync(bunPkgJsonPath, "utf8"));
    const bunBinRel =
      typeof bunPkg.bin === "string" ? bunPkg.bin : bunPkg.bin?.bun;
    if (!bunBinRel) {
      console.error("Could not resolve bundled Bun binary.");
      process.exit(1);
    }
    const bunBin = join(dirname(bunPkgJsonPath), bunBinRel);
    const serverEntry = join(packageRoot, "server", "bun.ts");
    if (!existsSync(serverEntry)) {
      console.error(`Server entry not found at ${serverEntry}.`);
      process.exit(1);
    }
    const result = spawnSync(bunBin, [serverEntry], {
      stdio: "inherit",
      env: {
        ...process.env,
        SKILLZKIT_STORAGE: options.storage ?? process.env.SKILLZKIT_STORAGE ?? "fs:auto",
        PORT: options.port ?? process.env.PORT ?? "3000",
      },
    });
    process.exit(result.status ?? 1);
  });

cli
  .command("ui", "Launch the interactive installer (requires bundled Bun runtime)")
  .option("--target <path>", "Target directory (default: current working directory)")
  .action(async (options: UiOptions) => {
    // First-run integration: if no config exists, walk the user
    // through `skillzkit init` interactively before spawning the TUI.
    // Reuses the same gatherInitOptions + runInit flow as `skillzkit
    // init` so the captured fields (mode, email, optional team
    // settings) are identical regardless of entry point.
    if (!configExists()) {
      console.log("");
      console.log("First-time setup — let's configure skillzkit.");
      console.log("");
      try {
        const opts = await gatherInitOptions({});
        const result = runInit(opts);
        console.log(`\n✓ Created ${result.path}`);
        console.log(`  Mode: ${result.config.mode}`);
        console.log("");
        console.log("Launching skillzkit ui...");
        console.log("");
      } catch (err) {
        console.error(`\n✗ Setup failed: ${(err as Error).message}`);
        console.error("Run \`skillzkit init\` to retry.");
        process.exit(1);
      }
    }
    launchTui(options.target ?? process.cwd());
  });

cli
  .command(
    "install [...slugs]",
    "Install all catalog items (no args), OR specific slugs/groups + transitive deps. Accepts: bare persona (product/engineer/market), wildcard prefix (core:tools:*, product:strategy:*), exact slug (core:tools:npm), or skill name (skillzkit-product-router)."
  )
  .option("--target <path>", "Target directory (default: current working directory)")
  .option("--force", "Overwrite existing files in the target")
  .option("--dry-run", "Print the resolved install plan without copying files")
  .action((slugs: string[], options: InstallOptions) => {
    const target = options.target ? options.target : process.cwd();
    const targetClaude = join(target, ".claude");

    // No slugs → blanket install. Treat it as "every non-context command,"
    // route through the same installSlugs() primitive so manifests get
    // written and skills get copied just like the selective path.
    if (!slugs || slugs.length === 0) {
      const targetCore = join(targetClaude, "commands", "core");
      if (existsSync(targetCore) && !options.force) {
        console.error(
          `Refusing to install: ${targetCore} already exists. Use --force to overwrite, ` +
            `or pass specific slugs to install just those + their dependencies.`
        );
        process.exit(1);
      }
      const catalog = loadCatalog();
      const allSlugs = new Set(
        catalog.commands.filter((c) => c.kind !== "context").map((c) => c.slug),
      );
      const result = installSlugs(allSlugs, catalog, packageRoot, target, {
        force: options.force,
      });
      console.log(
        `✓ Installed ${result.installedFiles} file(s) to ${targetClaude}`,
      );
      if (result.skippedExisting > 0) {
        console.log(
          `  (${result.skippedExisting} skipped — already exist; pass --force to overwrite)`,
        );
      }
      console.log("");
      console.log("Next steps:");
      console.log("  /core:tools:setup           — install/verify local tools");
      console.log("  /core:integrations:setup    — configure remote services");
      console.log("  /core:frameworks:init       — detect framework bindings");
      console.log("  /core:workflows:_index      — see the workflow decision tree");
      return;
    }

    // Selective install. First expand group-form picks (bare personas,
    // `prefix:*` wildcards) to concrete slugs, then walk the references
    // graph for transitive deps per the cascade rules in resolve.ts.
    const expanded = expandGroupIds(slugs);
    const { plan, missing } = resolveInstallPlan(expanded);

    if (missing.length > 0) {
      console.error(`✗ Unknown slugs (${missing.length}):`);
      for (const m of missing) console.error(`    ${m}`);
      console.error("");
      // Offer a near-miss hint when a single unknown slug looks like it
      // could be a typo (matches as a substring of one or more known
      // slugs). For multi-arg cases or when no near-miss exists, fall
      // back to the generic discovery hint.
      const hint = missing.length === 1 ? findNearMisses(missing[0]) : [];
      if (hint.length > 0) {
        console.error(`Did you mean:`);
        for (const h of hint.slice(0, 5)) console.error(`    ${h}`);
        console.error("");
      }
      console.error(
        `Run 'skillzkit search <query>' or 'skillzkit list' to find available items.`,
      );
      process.exit(1);
    }

    if (plan.length === 0) {
      console.error(`✗ Nothing to install (no slugs resolved).`);
      process.exit(1);
    }

    if (options.dryRun) {
      const expansionNote =
        expanded.length !== slugs.length
          ? ` — ${slugs.length} arg(s) expanded to ${expanded.length} slugs`
          : "";
      console.log(
        `Install plan: ${summarizePlan(plan)} (${plan.length} files)${expansionNote}`,
      );
      console.log(
        `  + always-installed: infra (audit, workflows, _context) + all skills + runtime manifests`,
      );
      console.log("");
      for (const item of plan) {
        const trace = item.requestedBy
          ? `   ← via ${item.requestedBy}`
          : "   (requested)";
        console.log(`  [${item.kind.padEnd(8)}] ${item.slug}${trace}`);
      }
      console.log("");
      console.log("Re-run without --dry-run to actually copy files.");
      return;
    }

    // Hand the plan's slug set to the shared installer so the CLI and
    // TUI install paths produce identical output: always-install infra
    // (audit, workflows, skills, _context) + runtime manifests for any
    // picked tools/integrations.
    const planSlugs = new Set(plan.map((p) => p.slug));
    const result = installSlugs(planSlugs, loadCatalog(), packageRoot, target, {
      force: options.force,
    });

    console.log(`✓ Installed ${result.installedFiles} file(s) to ${targetClaude}`);
    if (result.skippedExisting > 0) {
      console.log(
        `  (${result.skippedExisting} skipped — already exist; pass --force to overwrite)`,
      );
    }
    console.log(
      `  Includes ${result.alwaysInstalledCount} always-install infra files (audit, workflows, _context) + all skills.`,
    );
    console.log("");
    console.log("Requested:");
    for (const slug of slugs) console.log(`  - ${slug}`);
    if (expanded.length !== slugs.length) {
      console.log(`  → expanded to ${expanded.length} slugs`);
    }
    if (plan.length > expanded.length) {
      console.log("");
      console.log(`Plus ${plan.length - expanded.length} transitive dep(s).`);
    }
  });

cli
  .command(
    "suggest <slug>",
    "Suggest next tasks or workflows after completing <slug>",
  )
  .option("--limit <n>", "Maximum suggestions to print (default 8)")
  .option(
    "--state <path>",
    "Path to .pencil-workflow-state.json for active-workflow signal",
  )
  .action(
    (
      slug: string,
      options: { limit?: string; state?: string },
    ) => {
      const limit = options.limit ? Number.parseInt(options.limit, 10) : 8;

      let activeWorkflowState: ActiveWorkflowState | undefined;
      if (options.state && existsSync(options.state)) {
        try {
          const parsed = JSON.parse(readFileSync(options.state, "utf8"));
          if (parsed?.active?.workflow) {
            activeWorkflowState = {
              workflow: parsed.active.workflow,
              currentStep: parsed.active.currentStep,
            };
          }
        } catch (err) {
          console.error(
            `Could not read workflow state at ${options.state}: ${
              (err as Error).message
            }`,
          );
        }
      }

      const suggestions = suggestNext(slug, { limit, activeWorkflowState });
      if (suggestions.length === 0) {
        console.log(`No suggestions found for ${slug}.`);
        return;
      }

      console.log(`\nNext steps after ${slug}:\n`);
      for (const s of suggestions) {
        const tag = s.kind === "workflow" ? "[workflow]" : "[task]    ";
        console.log(`  ${tag}  ${s.slug}`);
        console.log(`            ${s.rationale} (score: ${s.score.toFixed(2)})`);
        console.log("");
      }
    },
  );

cli
  .command(
    "doctor",
    "Health check the kit — broken references, orphan files, frontmatter completeness, prerequisite resolution",
  )
  .option("--errors-only", "Show only error-severity findings")
  .action((options: { errorsOnly?: boolean }) => {
    const findings = runDoctor(packageRoot);
    const filtered = options.errorsOnly
      ? findings.filter((f) => f.severity === "error")
      : findings;

    if (filtered.length === 0) {
      console.log("✓ No issues found.");
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
      const tag =
        severity === "error" ? "✗" : severity === "warning" ? "⚠" : "ℹ";
      console.log(`\n${tag} ${severity.toUpperCase()} (${subset.length})`);
      for (const f of subset) {
        console.log(`  ${f.source}`);
        console.log(`    ${f.message}`);
      }
    }

    console.log(
      `\n${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`,
    );
    if (counts.error > 0) process.exit(1);
  });

cli
  .command(
    "init",
    "First-run setup — creates ~/.agentx/skillzkit/config.json. Interactive when called without args; pass flags to skip prompts.",
  )
  .option("--mode <mode>", "standalone | team")
  .option("--email <email>", "Your email (required, used for local artifact attribution and team-mode identity)")
  .option("--api-url <url>", "Team mode: skillzkit API base URL")
  .option("--api-key <key>", "Team mode: API key from agentx-controlplane")
  .option("--pin <pin>", "Team mode: PIN that encrypts the API key at rest (min 6 chars)")
  .option("--force", "Overwrite an existing config")
  .action(async (cliOpts: Partial<InitOptions> & { force?: boolean }) => {
    try {
      // Refuse to overwrite without --force BEFORE any prompts run —
      // saves the user from typing through the whole flow only to be
      // told "config already exists, --force required."
      if (configExists() && !cliOpts.force) {
        console.error(
          `Config already exists at ${configPath()}.`,
        );
        console.error(
          `  Pass --force to overwrite, or run \`skillzkit config\` to view/edit fields.`,
        );
        process.exit(1);
      }

      const opts = await gatherInitOptions(cliOpts);
      const result = runInit({ ...opts, force: cliOpts.force });

      console.log(
        `\n✓ ${result.overwrote ? "Updated" : "Created"} ${result.path}`,
      );
      console.log("");
      if (result.config.mode === "standalone") {
        console.log("Mode: standalone (using bundled skills)");
        console.log("Next:");
        console.log("  skillzkit list                  — browse the catalog");
        console.log("  skillzkit ui                    — interactive picker");
        console.log("  skillzkit install <slug>        — install a slug into your project");
      } else {
        console.log(`Mode: team`);
        console.log(`API:  ${result.config.team.apiUrl}`);
        console.log(`Key:  ${result.config.team.keyMasked}  (encrypted at rest)`);
        console.log("");
        console.log("Next:");
        console.log("  skillzkit ui                    — browse the team catalog");
        console.log("  skillzkit config                — view current configuration");
      }
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

cli
  .command(
    "config [field] [value]",
    "View or update one config field. `skillzkit config` shows all; `skillzkit config email new@x.com` updates that field.",
  )
  .option(
    "--show-secrets",
    "Reveal the encrypted-blob fields (the plaintext API key is never stored or shown)",
  )
  .action(
    (
      field: string | undefined,
      value: string | undefined,
      options: { showSecrets?: boolean },
    ) => {
      try {
        if (!configExists()) {
          console.error(
            `No config found. Run \`skillzkit init\` to create one.`,
          );
          process.exit(1);
        }
        const config = readConfig();

        if (!field) {
          printConfig(config, !!options.showSecrets);
          return;
        }
        if (!value) {
          // Single-field read: e.g. `skillzkit config email`
          const single = readField(config, field);
          if (single === undefined) {
            console.error(
              `Field "${field}" is not set on this config (mode=${config.mode})`,
            );
            process.exit(1);
          }
          console.log(single);
          return;
        }
        // Set
        const updated = setField(config, field, value);
        writeConfig(updated);
        console.log(`✓ Updated ${field} → ${value}`);
        console.log(`  ${configPath()}`);
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

cli
  .command("version", "Print the package version")
  .action(() => {
    const catalog = loadCatalog();
    console.log(catalog.packageVersion);
  });

cli
  .command(
    "tags",
    "List every tag in the catalog with usage counts, split into core (TAGS.md whitelist) and extension (free-form, candidates for promotion)",
  )
  .action(() => {
    const catalog = loadCatalog();
    const core = loadCoreTags(packageRoot);
    const counts = collectTagCounts(catalog);

    if (counts.size === 0) {
      console.log(
        "No tags found in the catalog. Add `tags: [...]` to artifact frontmatter; see TAGS.md for the curated core list.",
      );
      return;
    }

    // Split tags into core (in TAGS.md) and extension (everything else),
    // sorted by descending usage count then alphabetically. Showing
    // counts inline gives you a quick read on which extensions are
    // accumulating enough usage to deserve promotion.
    const used = new Set(counts.keys());
    const allTags = Array.from(new Set([...core, ...used])).sort();
    const coreUsed = allTags.filter((t) => core.has(t));
    const extensions = allTags.filter((t) => !core.has(t));
    const byCount = (a: string, b: string) =>
      (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);

    console.log(`\n=== Core tags (${coreUsed.length}) ===`);
    if (coreUsed.length === 0) {
      console.log("  (TAGS.md present but no core tags found in the catalog)");
    }
    for (const tag of coreUsed.sort(byCount)) {
      const n = counts.get(tag) ?? 0;
      const marker = n === 0 ? " (unused)" : "";
      console.log(`  ${tag.padEnd(20)} ${n} use${n === 1 ? "" : "s"}${marker}`);
    }

    console.log(`\n=== Extension tags (${extensions.length}) ===`);
    if (extensions.length === 0) {
      console.log("  (no extension tags in use)");
    }
    for (const tag of extensions.sort(byCount)) {
      const n = counts.get(tag) ?? 0;
      console.log(`  ${tag.padEnd(20)} ${n} use${n === 1 ? "" : "s"}`);
    }

    if (extensions.length > 0) {
      console.log(
        "\nExtension tags with broad usage (≥5 artifacts, ≥2 personas) are candidates for promotion into TAGS.md core. See TAGS.md for the criteria.",
      );
    }
  });

cli.help();
cli.version("0.1.0");

cli.parse();

/**
 * Render the catalog as an indented tree, deriving hierarchy from
 * slug structure (each colon-segment becomes a level). Sorted
 * alphabetically. Emits ancestor "namespace/" headers when crossing
 * into a new branch, then leaf rows showing the full slug + a
 * truncated description. Skills appended as a flat trailing section
 * (they don't follow the slug-namespace convention).
 */
function renderTreeView(): string {
  const cmds = getCommands()
    .filter((c) => c.kind !== "context")
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const out: string[] = [];
  const lastPath: string[] = [];

  for (const cmd of cmds) {
    const parts = cmd.slug.split(":");
    const ancestors = parts.slice(0, -1);

    let common = 0;
    while (
      common < ancestors.length &&
      common < lastPath.length &&
      ancestors[common] === lastPath[common]
    ) {
      common++;
    }

    for (let i = common; i < ancestors.length; i++) {
      out.push(`${"  ".repeat(i)}${ancestors[i]}/`);
    }

    const indent = "  ".repeat(ancestors.length);
    const tag = cmd.kind === "workflow" ? "[wf]" : "    ";
    out.push(
      `${indent}${tag} /${cmd.slug}  —  ${truncate(cmd.description, 70)}`,
    );

    lastPath.length = 0;
    lastPath.push(...ancestors);
  }

  const skills = getSkills();
  if (skills.length > 0) {
    out.push("");
    out.push(`Skills (${skills.length})`);
    for (const s of skills) {
      out.push(`  ${s.name}  —  ${truncate(s.description, 70)}`);
    }
  }

  return out.join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/**
 * Format a plan as a one-line "N workflows, M commands, K skills"
 * summary. Skips zero-count categories so the line stays compact.
 */
function summarizePlan(plan: readonly ResolvedItem[]): string {
  const counts: Record<ResolvedItem["kind"], number> = {
    command: 0,
    workflow: 0,
    skill: 0,
  };
  for (const item of plan) counts[item.kind]++;
  const parts: string[] = [];
  if (counts.workflow)
    parts.push(`${counts.workflow} workflow${counts.workflow === 1 ? "" : "s"}`);
  if (counts.command)
    parts.push(`${counts.command} command${counts.command === 1 ? "" : "s"}`);
  if (counts.skill)
    parts.push(`${counts.skill} skill${counts.skill === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : "(empty)";
}

/**
 * Levenshtein edit distance — minimum number of single-char insertions,
 * deletions, or substitutions to transform `a` into `b`. Two-row
 * optimization (O(n) memory) since the catalog has hundreds of slugs
 * and we run this against each.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Edit-distance suggest for an unknown slug. Compares both the full
 * slug and just the leaf segment (last colon-piece) — a typo deep in
 * a long slug should still surface a hint. Threshold is 2 edits or
 * 1/3 the input length, whichever is larger, so short slugs require
 * tighter matches and long slugs tolerate more.
 */
function findNearMisses(unknown: string): string[] {
  const q = unknown.toLowerCase();
  const qLeaf = q.split(":").pop() ?? q;
  const tolerance = Math.max(2, Math.floor(q.length / 3));

  const scored: Array<{ id: string; distance: number }> = [];

  for (const c of getCommands()) {
    const slug = c.slug.toLowerCase();
    const slugLeaf = slug.split(":").pop() ?? slug;
    const dFull = levenshtein(q, slug);
    const dLeaf = levenshtein(qLeaf, slugLeaf);
    const distance = Math.min(dFull, dLeaf);
    if (distance <= tolerance) scored.push({ id: c.slug, distance });
  }
  for (const s of getSkills()) {
    const distance = levenshtein(q, s.name.toLowerCase());
    if (distance <= tolerance) scored.push({ id: s.name, distance });
  }

  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((entry) => entry.id);
}

/**
 * Render the current config to stdout. Plaintext API key is NEVER
 * shown (it isn't stored). The masked version is always shown. The
 * encrypted-blob fields are hidden by default; --show-secrets reveals
 * them so a user can verify what's on disk without grep-and-jq.
 */
function printConfig(config: SkillzkitConfig, showSecrets: boolean): void {
  console.log(`# skillzkit config`);
  console.log(`# ${configPath()}`);
  console.log("");
  console.log(`mode       = ${config.mode}`);
  console.log(`email      = ${config.email}`);
  console.log(`createdAt  = ${config.createdAt}`);
  console.log(`updatedAt  = ${config.updatedAt}`);
  if (config.mode === "team") {
    console.log("");
    console.log(`team.apiUrl    = ${config.team.apiUrl}`);
    console.log(`team.keyMasked = ${config.team.keyMasked}`);
    if (showSecrets) {
      // Show the encrypted blob's bookkeeping fields so a user can
      // verify their config matches what they expect. The plaintext
      // key is not in this output — it isn't stored anywhere.
      const blob = config.team.keyEncrypted;
      console.log(`team.keyEncrypted.kdf       = ${blob.kdf}`);
      console.log(
        `team.keyEncrypted.kdfParams = N=${blob.kdfParams.N}, r=${blob.kdfParams.r}, p=${blob.kdfParams.p}`,
      );
      console.log(`team.keyEncrypted.salt      = ${blob.salt}`);
      console.log(`team.keyEncrypted.iv        = ${blob.iv}`);
      console.log(`team.keyEncrypted.authTag   = ${blob.authTag}`);
      console.log(
        `team.keyEncrypted.ciphertext = <${blob.ciphertext.length} chars base64>`,
      );
    }
  }
}

/**
 * Read a single field by dotted-path name. Returns undefined when the
 * field isn't applicable to this config's mode (e.g., asking for
 * `team.apiUrl` on a standalone config).
 */
function readField(config: SkillzkitConfig, field: string): string | undefined {
  switch (field) {
    case "mode":
      return config.mode;
    case "email":
      return config.email;
    case "createdAt":
      return config.createdAt;
    case "updatedAt":
      return config.updatedAt;
    case "team.apiUrl":
    case "apiUrl":
      return config.mode === "team" ? config.team.apiUrl : undefined;
    case "team.keyMasked":
    case "keyMasked":
      return config.mode === "team" ? config.team.keyMasked : undefined;
    default:
      throw new Error(
        `Unknown field "${field}". Try one of: mode, email, apiUrl, keyMasked`,
      );
  }
}

/**
 * Update a single field. The settable surface is intentionally small:
 * email (when safe — see below) and team.apiUrl. Anything that would
 * invalidate the encrypted key (changing email on team mode, changing
 * the API key, switching modes) is refused with a pointer to
 * `skillzkit init --force`. Treating those as a single atomic re-init
 * is safer than half-updating the on-disk state.
 */
function setField(
  config: SkillzkitConfig,
  field: string,
  value: string,
): SkillzkitConfig {
  switch (field) {
    case "email": {
      // On team mode, the email is part of the encryption passphrase.
      // Changing it would orphan the encrypted key blob — there's no
      // way to decrypt it without the original email. Refuse and
      // direct the user to a full re-init that re-encrypts.
      if (config.mode === "team") {
        throw new Error(
          `Changing email on a team-mode config would invalidate your encrypted API key (the email is part of the encryption passphrase). Use \`skillzkit init --force\` to change email and re-enter your API key + PIN.`,
        );
      }
      return { ...config, email: value };
    }
    case "team.apiUrl":
    case "apiUrl": {
      if (config.mode !== "team") {
        throw new Error(
          `apiUrl is only valid on team-mode configs. Run \`skillzkit init --force\` to switch modes.`,
        );
      }
      try {
        new URL(value);
      } catch {
        throw new Error(`Invalid URL "${value}"`);
      }
      return {
        ...config,
        team: { ...config.team, apiUrl: value },
      };
    }
    case "mode":
      throw new Error(
        `Mode change requires a full re-init (encryption + key collection). Run \`skillzkit init --force --mode ${value}\`.`,
      );
    default:
      throw new Error(
        `Field "${field}" is not settable. Settable fields: email, apiUrl. Use \`skillzkit init --force\` for anything else.`,
      );
  }
}

/**
 * Fill in any init fields the user didn't pass via CLI args by
 * prompting interactively. Designed so passing every flag results in
 * zero prompts (good for scripts, CI), while passing nothing walks
 * the user through every required field (good for first-time setup).
 *
 * Mode is asked first because it gates which subsequent fields are
 * required — team mode needs apiUrl/apiKey/pin; standalone doesn't.
 */
async function gatherInitOptions(
  cli: Partial<InitOptions> & { force?: boolean },
): Promise<InitOptions> {
  console.log("");
  console.log("skillzkit setup");
  console.log("");

  let mode: "standalone" | "team";
  if (cli.mode === "standalone" || cli.mode === "team") {
    mode = cli.mode;
  } else {
    const answer = (
      await prompt(
        "Mode? (1) standalone — use bundled skills  (2) team — connect to a shared API: ",
      )
    ).trim();
    if (answer === "1" || answer.toLowerCase().startsWith("s")) {
      mode = "standalone";
    } else if (answer === "2" || answer.toLowerCase().startsWith("t")) {
      mode = "team";
    } else {
      throw new Error(`Mode must be "standalone" or "team"`);
    }
  }

  const email = cli.email ?? (await prompt("Email: ")).trim();

  if (mode === "standalone") {
    // Close the shared readline interface so node can exit cleanly
    // (or so the TUI launched after init can claim stdin).
    closePrompts();
    return { mode, email };
  }

  // Team-only fields. apiUrl is the last visible prompt; promptHidden
  // closes readline internally before switching to raw mode.
  const apiUrl =
    cli.apiUrl ?? (await prompt("API URL (e.g. https://skillz.example.com): ")).trim();
  const apiKey =
    cli.apiKey ?? (await promptHidden("API key (from agentx-controlplane): ")).trim();
  const pin = cli.pin ?? (await promptHidden("PIN (min 6 chars, used to encrypt key at rest): "));

  return { mode, email, apiUrl, apiKey, pin };
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

