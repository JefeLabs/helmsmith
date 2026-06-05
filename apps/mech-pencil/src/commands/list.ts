/**
 * `mech-pencil list` — show registered frameworks, or one framework's
 * atomic component catalog grouped atom → molecule → organism.
 */

import { ATOMIC_ORDER } from '../design-system/atomic.ts';
import { getFramework, listFrameworks } from '../frameworks/_core/registry.ts';
import { bullet, dim, heading } from '../ui.ts';

export interface ListOptions {
  framework?: string;
}

export function runList(options: ListOptions = {}): void {
  if (!options.framework) {
    console.log(heading('Frameworks'));
    for (const a of listFrameworks()) {
      console.log(bullet(`${a.id.padEnd(12)} ${dim(a.description)}`));
    }
    console.log('');
    console.log(dim('mech-pencil list --framework <id>  to see its component catalog'));
    return;
  }

  const adapter = getFramework(options.framework);
  const specs = adapter.components();
  console.log(heading(`${adapter.title} — ${specs.length} components`));
  if (adapter.reference) console.log(dim(adapter.reference));

  for (const level of ATOMIC_ORDER) {
    const inLevel = specs.filter((s) => s.level === level);
    if (inLevel.length === 0) continue;
    console.log('');
    console.log(heading(`${level}s (${inLevel.length})`));
    const names = inLevel.map((s) => s.name);
    // Three-column layout for a compact catalog.
    for (let i = 0; i < names.length; i += 3) {
      console.log(`  ${names.slice(i, i + 3).map((n) => n.padEnd(22)).join('')}`);
    }
  }
}
