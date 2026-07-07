import { getCommands, getSkills, getWorkflows } from '../index.js';
import { truncate } from './_shared/format.js';

export interface ListOptions {
  commands?: boolean;
  skills?: boolean;
  workflows?: boolean;
  kind?: 'command' | 'workflow' | 'context';
  tree?: boolean;
  tag?: string;
}

/**
 * List commands, skills, and workflows in the catalog. Honors:
 *   --commands / --skills / --workflows  (filter to one category)
 *   --kind <kind>                        (commands of a specific kind)
 *   --tree                               (hierarchical render)
 *   --tag <name>                         (filter by tag)
 */
export function runList(options: ListOptions = {}): void {
  if (options.tree) {
    console.log(renderTreeView());
    return;
  }

  const showAll = !options.commands && !options.skills && !options.workflows;
  const hasTag = (tags: string[] | undefined) => !options.tag || (tags ?? []).includes(options.tag);

  if (showAll || options.commands) {
    const commands = getCommands().filter(
      (c) => (options.kind ? c.kind === options.kind : c.kind === 'command') && hasTag(c.tags),
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
      const dur = wf.estimatedDuration ? ` (${wf.estimatedDuration})` : '';
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
}

/**
 * Render the catalog as an indented tree, deriving hierarchy from
 * slug structure (each colon-segment becomes a level). Sorted
 * alphabetically. Skills appended as a flat trailing section (they
 * don't follow the slug-namespace convention).
 */
function renderTreeView(): string {
  const cmds = getCommands()
    .filter((c) => c.kind !== 'context')
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const out: string[] = [];
  const lastPath: string[] = [];

  for (const cmd of cmds) {
    const parts = cmd.slug.split(':');
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
      out.push(`${'  '.repeat(i)}${ancestors[i]}/`);
    }

    const indent = '  '.repeat(ancestors.length);
    const tag = cmd.kind === 'workflow' ? '[wf]' : '    ';
    out.push(`${indent}${tag} /${cmd.slug}  —  ${truncate(cmd.description, 70)}`);

    lastPath.length = 0;
    lastPath.push(...ancestors);
  }

  const skills = getSkills();
  if (skills.length > 0) {
    out.push('');
    out.push(`Skills (${skills.length})`);
    for (const s of skills) {
      out.push(`  ${s.name}  —  ${truncate(s.description, 70)}`);
    }
  }

  return out.join('\n');
}
