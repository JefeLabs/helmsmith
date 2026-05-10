import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCommands, getSkills, loadCatalog } from "../index.js";
import { installSlugs } from "../install.js";
import {
  expandGroupIds,
  resolveInstallPlan,
  type ResolvedItem,
} from "../resolve.js";
import { findPackageRoot } from "./_shared/package-root.js";
import { levenshtein } from "./_shared/format.js";

export interface InstallOptions {
  target?: string;
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Install all catalog items (no slugs) OR specific slugs/groups +
 * transitive deps. Accepts: bare persona (product/engineer/market),
 * wildcard prefix (core:tools:*, product:strategy:*), exact slug
 * (core:tools:npm), or skill name (skillzkit-product-router).
 */
export function runInstall(slugs: string[], options: InstallOptions = {}): void {
  const packageRoot = findPackageRoot();
  const target = options.target ? options.target : process.cwd();
  const targetClaude = join(target, ".claude");

  // No slugs → blanket install. Treat as "every non-context command,"
  // route through the same installSlugs() primitive so manifests get
  // written and skills get copied just like the selective path.
  if (!slugs || slugs.length === 0) {
    const targetCore = join(targetClaude, "commands", "core");
    if (existsSync(targetCore) && !options.force) {
      console.error(
        `Refusing to install: ${targetCore} already exists. Use --force to overwrite, ` +
          `or pass specific slugs to install just those + their dependencies.`,
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
 * Edit-distance suggest for an unknown slug. Compares both the full
 * slug and just the leaf segment. Threshold is 2 edits or 1/3 the
 * input length, whichever is larger.
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
