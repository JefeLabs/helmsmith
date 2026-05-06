/**
 * Selective install plan resolver.
 *
 * Given a list of requested slugs (commands, workflows, or skills), walks
 * the catalog's `references[]` graph BFS-style to produce a flat install
 * plan that includes every transitive dependency.
 *
 * Used by `skillzkit install <slug>...` to copy only the needed markdown
 * files (plus deps) into a target project's `.claude/` directory, instead
 * of the blanket-install behavior of `skillzkit install` (no args).
 *
 * Slug forms accepted:
 *   - command/workflow slug — e.g. `core:tools:npm`, `engineer:feature-build`
 *   - skill name — e.g. `skillzkit-product-router`
 *
 * The resolver tries command/workflow lookup first (most common case),
 * then falls back to skill name. Slugs that don't match any catalog item
 * are returned in `missing[]` rather than throwing — callers can decide
 * how strict to be.
 */

import { getCommand, getSkill, getWorkflow } from "./index.js";

export type ResolvedKind = "command" | "workflow" | "skill";

export interface ResolvedItem {
  kind: ResolvedKind;
  /** For commands/workflows: the slash-command slug. For skills: the skill name. */
  slug: string;
  /** Filesystem path relative to `.claude/commands/` or `.claude/skills/`. */
  path: string;
  /** Markdown body. Useful for `--dry-run` printing without copying files. */
  body: string;
  /** Item that triggered this dependency, or undefined if directly requested. */
  requestedBy?: string;
}

export interface ResolveResult {
  /** Plan in BFS order: requested items first, then their deps. */
  plan: ResolvedItem[];
  /** Slugs requested or referenced that didn't match any catalog item. */
  missing: string[];
}

/**
 * Walk the dependency graph for each requested slug. Skills' references
 * point at slash-command slugs (commands/workflows), so a skill's deps
 * are always commands/workflows. Commands and workflows can reference
 * other commands/workflows — those edges produce the transitive plan.
 */
export function resolveInstallPlan(requested: readonly string[]): ResolveResult {
  const plan: ResolvedItem[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];

  // Queue carries [slug, requestedBy?] so we can attribute transitive deps
  // to the user-requested slug that pulled them in.
  const queue: Array<{ slug: string; requestedBy?: string }> = requested.map(
    (slug) => ({ slug })
  );

  while (queue.length > 0) {
    const { slug, requestedBy } = queue.shift()!;
    if (seen.has(slug)) continue;
    seen.add(slug);

    const found = findItem(slug);
    if (!found) {
      missing.push(slug);
      continue;
    }

    plan.push({
      kind: found.kind,
      slug,
      path: found.item.path,
      body: found.item.body,
      ...(requestedBy ? { requestedBy } : {}),
    });

    for (const ref of found.item.references) {
      if (!seen.has(ref)) {
        queue.push({ slug: ref, requestedBy: slug });
      }
    }
  }

  return { plan, missing };
}

/**
 * Resolved-item shape used internally — all three sources are normalized
 * to this so the BFS loop has a uniform shape to work with. Workflows
 * don't have a `.path` field directly; we route through their underlying
 * command (which they were derived from in `deriveWorkflows`).
 */
interface NormalizedItem {
  path: string;
  body: string;
  references: string[];
}

/**
 * Look up a slug across all three catalogs. Order: commands → workflows
 * (qualifiedName form) → skills. Most install requests target commands.
 * Workflows can be requested by their `qualifiedName` (e.g.
 * `product:greenfield`) — we redirect to the underlying command so the
 * file path resolves correctly. Skills are looked up by name.
 */
function findItem(
  slug: string
): { kind: ResolvedKind; item: NormalizedItem } | undefined {
  const cmd = getCommand(slug);
  if (cmd) {
    return {
      kind: cmd.kind === "workflow" ? "workflow" : "command",
      item: { path: cmd.path, body: cmd.body, references: cmd.references },
    };
  }
  const wf = getWorkflow(slug);
  if (wf) {
    // Workflow objects lack `.path`; resolve via the underlying command.
    const underlying = getCommand(wf.commandSlug);
    if (!underlying) return undefined;
    return {
      kind: "workflow",
      item: { path: underlying.path, body: wf.body, references: wf.references },
    };
  }
  const skill = getSkill(slug);
  if (skill) {
    return {
      kind: "skill",
      item: { path: skill.path, body: skill.body, references: skill.references },
    };
  }
  return undefined;
}
