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

import { getCommand, getCommands, getSkill, getWorkflow } from "./index.js";

export type ResolvedKind = "command" | "workflow" | "skill";

/**
 * Expand group-form picks to their constituent slugs. Lets a CLI user
 * say "install everything in this namespace" without enumerating each
 * leaf. Forms accepted:
 *
 *   - `product` / `engineer` / `market`   → all non-context commands in
 *                                            that persona's namespace
 *   - `<prefix>:*`                         → all non-context commands
 *                                            whose slug starts with
 *                                            `<prefix>:`. Examples:
 *                                            `core:tools:*`,
 *                                            `product:strategy:*`,
 *                                            `core:frameworks:heroui:*`.
 *   - any other string                     → passed through verbatim
 *                                            (real slug or skill name —
 *                                            resolveInstallPlan validates)
 *
 * Returns a deduped array; original ordering of the inputs is not
 * preserved (Set semantics).
 */
export function expandGroupIds(picks: readonly string[]): string[] {
  const slugs = new Set<string>();
  const personas = new Set(["product", "engineer", "market"]);
  for (const pick of picks) {
    if (personas.has(pick)) {
      for (const cmd of getCommands()) {
        if (cmd.slug.startsWith(`${pick}:`) && cmd.kind !== "context") {
          slugs.add(cmd.slug);
        }
      }
    } else if (pick.endsWith(":*")) {
      const prefix = pick.slice(0, -1); // keep trailing colon
      for (const cmd of getCommands()) {
        if (cmd.slug.startsWith(prefix) && cmd.kind !== "context") {
          slugs.add(cmd.slug);
        }
      }
    } else {
      slugs.add(pick);
    }
  }
  return Array.from(slugs);
}

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
 * Walk the dependency graph for each requested slug. Cascade rules
 * mirror the TUI's resolveCascade in tui/state.ts so a `skillzkit
 * install <slug>` and a TUI install of the same item produce the
 * same closure:
 *
 *   - SKILL seed → walk all refs unconditionally. Skills are routers;
 *     their refs ARE the commands they route to, so requesting a skill
 *     means "give me this skill plus its routed commands."
 *
 *   - WORKFLOW seed → walk refs but skip `core:*` (tools/integrations
 *     are picked separately, not auto-pulled) and only propagate
 *     further when the referenced item is itself a workflow. Non-
 *     workflow refs are added once but don't recursively cascade.
 *
 *   - COMMAND seed → don't cascade at all. A command body that
 *     mentions other commands is documentation, not a runtime
 *     dependency.
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

    if (found.kind === "skill") {
      for (const ref of found.item.references) {
        if (!seen.has(ref)) queue.push({ slug: ref, requestedBy: slug });
      }
    } else if (found.kind === "workflow") {
      for (const ref of found.item.references) {
        if (ref.startsWith("core:")) continue;
        if (seen.has(ref)) continue;
        queue.push({ slug: ref, requestedBy: slug });
      }
    }
    // Commands don't cascade.
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
