import { chmodSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkkitError } from './errors.js';
import { Git } from './git.js';

export const HOOKS_DIR = '.helmsmith/hooks';
const HOOKS = ['pre-commit', 'pre-push'] as const;

/**
 * Write the two hook scripts (each hands over to `workbrokr hook <name>`, so the rules stay in
 * TypeScript) and point this clone's core.hooksPath at them. The scripts are meant to be
 * committed; the config is per clone.
 */
export function installHooks(repoRoot: string): { hooksDir: string; files: string[] } {
  const hooksDir = join(repoRoot, HOOKS_DIR);
  mkdirSync(hooksDir, { recursive: true });
  const files: string[] = [];
  for (const name of HOOKS) {
    const file = join(hooksDir, name);
    // A symlink planted at the hook's path would turn this write into a write elsewhere.
    let existing: ReturnType<typeof lstatSync> | undefined;
    try {
      existing = lstatSync(file);
    } catch {
      existing = undefined;
    }
    if (existing?.isSymbolicLink()) {
      throw new WorkkitError('INTERNAL', `refusing to write hook ${file}: it is a symlink`, {
        file,
      });
    }
    writeFileSync(
      file,
      `#!/bin/sh\n# Installed by \`work init\`; the rules live in @helmsmith/workbrokr. Exits 0 when workbrokr is absent.\ncommand -v workbrokr >/dev/null 2>&1 || exit 0\nexec workbrokr hook ${name} "$@"\n`,
    );
    chmodSync(file, 0o755);
    files.push(file);
  }
  new Git(repoRoot).run(['config', 'core.hooksPath', HOOKS_DIR]);
  return { hooksDir, files };
}
