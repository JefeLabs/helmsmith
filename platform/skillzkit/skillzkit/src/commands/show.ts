import { getCommand, getSkill, getWorkflow } from '../index.js';

/**
 * Print the full body of one command, skill, or workflow by slug or
 * name. Looks up in all three kinds and dispatches to whichever
 * matches first.
 */
export function runShow(slug: string): void {
  const cmd = getCommand(slug);
  if (cmd) {
    printItem('command', cmd.slug, cmd.description, cmd.body);
    return;
  }
  const skill = getSkill(slug);
  if (skill) {
    printItem('skill', skill.name, skill.description, skill.body);
    return;
  }
  const wf = getWorkflow(slug);
  if (wf) {
    printItem('workflow', wf.qualifiedName, wf.description, wf.body);
    return;
  }
  console.error(`Not found: ${slug}`);
  process.exit(1);
}

function printItem(kind: string, identifier: string, description: string, body: string): void {
  console.log(`# ${kind}: ${identifier}`);
  console.log('');
  console.log(`> ${description}`);
  console.log('');
  console.log('---');
  console.log('');
  console.log(body);
}
