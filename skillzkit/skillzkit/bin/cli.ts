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
  .action((options: ListOptions) => {
    if (options.tree) {
      console.log(renderTreeView());
      return;
    }

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
  .command(
    "search <query>",
    "Find commands, workflows, and skills whose slug or description matches",
  )
  .option("--limit <n>", "Maximum results per kind (default 10)")
  .action((query: string, options: { limit?: string }) => {
    const limit = options.limit ? Number.parseInt(options.limit, 10) : 10;
    const q = query.toLowerCase();
    const matches = (haystack: string) => haystack.toLowerCase().includes(q);

    const cmds = getCommands().filter(
      (c) => c.kind === "command" && (matches(c.slug) || matches(c.description)),
    );
    const wfs = getWorkflows().filter(
      (w) => matches(w.qualifiedName) || matches(w.description),
    );
    const skls = getSkills().filter(
      (s) => matches(s.name) || matches(s.description),
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
  .command("ui", "Launch the interactive installer (requires bundled Bun runtime)")
  .option("--target <path>", "Target directory (default: current working directory)")
  .action((options: UiOptions) => {
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
  .command("version", "Print the package version")
  .action(() => {
    const catalog = loadCatalog();
    console.log(catalog.packageVersion);
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

