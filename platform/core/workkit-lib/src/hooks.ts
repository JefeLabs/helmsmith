import { chmodSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkkitError } from './errors.js';
import { Git } from './git.js';

export const HOOKS_DIR = '.helmsmith/hooks';

/**
 * The protected-branch rule is enforced by the shell script itself, with the list baked in at
 * install time, so it holds in a GUI client or a shell without `workbrokr` on PATH. Only the
 * commons and scope checks need the binary; without it they are skipped with a warning.
 */
function preCommitScript(protectedBranches: string[]): string {
  return `#!/bin/sh
# Installed by \`work init\` (@helmsmith/workbrokr). The protected-branch rule lives here; the rest in workbrokr.
PROTECTED="${protectedBranches.join(' ')}"
branch=$(git symbolic-ref --short -q HEAD)
for p in $PROTECTED; do
  if [ "$branch" = "$p" ]; then
    echo "work: branch \\"$branch\\" is protected ($PROTECTED): work happens on <type>/<area> branches, never here" >&2
    exit 2
  fi
done
if ! command -v workbrokr >/dev/null 2>&1; then
  echo "work: workbrokr is not on PATH; commons and scope checks skipped (npm i -g @helmsmith/workbrokr)" >&2
  exit 0
fi
exec workbrokr hook pre-commit "$@"
`;
}

function prePushScript(protectedBranches: string[]): string {
  return `#!/bin/sh
# Installed by \`work init\` (@helmsmith/workbrokr). Refuses a push to, or a delete of, a protected branch here; the rest in workbrokr.
PROTECTED="${protectedBranches.join(' ')}"
input=$(cat)
printf '%s\\n' "$input" | while read -r lref lsha rref rsha; do
  [ -n "$rref" ] || continue
  dest=\${rref#refs/heads/}
  for p in $PROTECTED; do
    if [ "$dest" = "$p" ]; then
      echo "work: \\"$dest\\" is protected ($PROTECTED): nothing is pushed to it directly, open a PR from an area branch" >&2
      exit 2
    fi
  done
done || exit 2
if ! command -v workbrokr >/dev/null 2>&1; then
  echo "work: workbrokr is not on PATH; scope and commons warnings skipped" >&2
  exit 0
fi
printf '%s\\n' "$input" | exec workbrokr hook pre-push "$@"
`;
}

export function installHooks(
  repoRoot: string,
  opts: { protectedBranches: string[] },
): { hooksDir: string; files: string[] } {
  const hooksDir = join(repoRoot, HOOKS_DIR);
  mkdirSync(hooksDir, { recursive: true });
  const files: string[] = [];
  const scripts: [string, string][] = [
    ['pre-commit', preCommitScript(opts.protectedBranches)],
    ['pre-push', prePushScript(opts.protectedBranches)],
  ];
  for (const [name, body] of scripts) {
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
    writeFileSync(file, body);
    chmodSync(file, 0o755);
    files.push(file);
  }
  new Git(repoRoot).run(['config', 'core.hooksPath', HOOKS_DIR]);
  return { hooksDir, files };
}
