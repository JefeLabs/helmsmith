import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './version.js';

/** The shipped agent files under `<package>/agents/`, read at run time. */
export function readAgentFile(name: 'pritty.md' | 'AGENTS.section.md'): string {
  return readFileSync(join(packageRoot(), 'agents', name), 'utf8');
}
