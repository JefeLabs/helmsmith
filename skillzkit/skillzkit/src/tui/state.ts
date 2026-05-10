import type { Catalog } from '../types.js';

export interface ResolvedSelection {
  /** User-chosen items (toggleable) */
  selected: Set<string>;
  /** Transitively-required items (locked, cannot be deselected) */
  locked: Set<string>;
}

/**
 * Resolve a cascade selection from a set of user-chosen identifiers.
 *
 * Identifiers can be:
 *   - A persona name: "product", "engineer", "market" — expands to all
 *     workflows in that domain
 *   - A command slug: "core:tools:npm", "product:strategy:greenfield" —
 *     selected directly
 *
 * For every selected item, walks its `references` (and theirs, recursively)
 * to compute the locked set of transitive dependencies.
 */
export function resolveCascade(userPicks: Set<string>, catalog: Catalog): ResolvedSelection {
  const selected = new Set<string>();

  // Step 1: expand group picks; pass through command picks.
  for (const pick of userPicks) {
    if (pick === 'product' || pick === 'engineer' || pick === 'market') {
      // Persona → every command in its namespace (excluding context files)
      for (const cmd of catalog.commands) {
        if (cmd.slug.startsWith(`${pick}:`) && cmd.kind !== 'context') {
          selected.add(cmd.slug);
        }
      }
    } else if (pick.startsWith('topic:')) {
      // Topic area → every command under that topic's prefix
      // pick format: "topic:<persona>:<topic>", strip "topic:" → "persona:topic" prefix
      const prefix = `${pick.slice('topic:'.length)}:`;
      for (const cmd of catalog.commands) {
        if (cmd.slug.startsWith(prefix) && cmd.kind !== 'context') {
          selected.add(cmd.slug);
        }
      }
    } else if (pick.startsWith('subns:')) {
      // Sub-namespace folder → every command under that sub-namespace's
      // prefix. Format: "subns:<persona>:<topic>:<subns>" — strip the
      // "subns:" prefix and append ":" to get the slug-prefix to match
      // (e.g. "subns:product:ux:journeys" → "product:ux:journeys:").
      const prefix = `${pick.slice('subns:'.length)}:`;
      for (const cmd of catalog.commands) {
        if (cmd.slug.startsWith(prefix) && cmd.kind !== 'context') {
          selected.add(cmd.slug);
        }
      }
    } else if (pick === 'frameworks:heroui' || pick === 'frameworks:storybook') {
      // Framework group → every file under that framework's namespace
      const prefix = `core:${pick}`;
      for (const cmd of catalog.commands) {
        if (cmd.slug === prefix || cmd.slug.startsWith(`${prefix}:`)) {
          selected.add(cmd.slug);
        }
      }
    } else if (catalog.commands.some((c) => c.slug === pick)) {
      // Individual command slug (integrations:*, tools:*, individual workflow)
      selected.add(pick);
    }
  }

  // Step 2: BFS the reference graph — but only WORKFLOWS cascade.
  //
  // Rules:
  //   1. Only items with kind="workflow" walk their references. Picking an
  //      individual command (framework file, integration, tool) does NOT
  //      cascade. Workflows are orchestrators — their references are the
  //      commands the workflow walks the user through; locking those is
  //      what makes a workflow runnable.
  //   2. Nothing in core/* is auto-locked. Tools, integrations, frameworks
  //      are chosen individually from their catalog sections.
  //   3. If a workflow references another workflow, that's chained — the
  //      target workflow's references are also walked.
  //
  // Core infrastructure (core:audit + core:workflows) is handled at
  // install time as always-installed, not via the cascade.
  const locked = new Set<string>();
  const queue: string[] = [];

  // Seed the queue with only the workflow items in `selected`.
  for (const slug of selected) {
    const cmd = catalog.commands.find((c) => c.slug === slug);
    if (cmd?.kind === 'workflow') queue.push(slug);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const cmd = catalog.commands.find((c) => c.slug === current);
    if (!cmd) continue;
    for (const ref of cmd.references) {
      if (ref.startsWith('core:')) continue;
      if (selected.has(ref) || locked.has(ref)) continue;
      locked.add(ref);
      // Only continue propagation if the ref is itself a workflow.
      const refCmd = catalog.commands.find((c) => c.slug === ref);
      if (refCmd?.kind === 'workflow') queue.push(ref);
    }
  }

  return { selected, locked };
}

/**
 * Counts for the summary footer.
 */
export interface SelectionSummary {
  personas: number;
  workflows: number;
  commands: number;
  lockedCore: number;
  totalFiles: number;
}

export function summarize(resolved: ResolvedSelection, catalog: Catalog): SelectionSummary {
  const all = new Set([...resolved.selected, ...resolved.locked]);
  let workflows = 0;
  let commands = 0;
  let lockedCore = 0;
  for (const slug of all) {
    const cmd = catalog.commands.find((c) => c.slug === slug);
    if (!cmd) continue;
    if (cmd.kind === 'workflow') workflows++;
    else if (cmd.kind === 'command') commands++;
    if (slug.startsWith('core:') && resolved.locked.has(slug)) lockedCore++;
  }
  // Personas count = how many top-level domains have any selection
  const personas = new Set<string>();
  for (const slug of all) {
    const domain = slug.split(':')[0];
    personas.add(domain);
  }
  return {
    personas: personas.size,
    workflows,
    commands,
    lockedCore,
    totalFiles: all.size,
  };
}
