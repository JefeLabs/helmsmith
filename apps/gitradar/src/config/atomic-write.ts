import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Replace `target` with `content` without ever following a planted symlink.
 *
 * - With `backup`, the previous file is kept as `<target>.bak`: the old `.bak` is
 *   unlinked first (unlink does not follow symlinks) and the copy is created
 *   exclusively, so a `.bak` symlink dropped into a project's `.agentx/` cannot make
 *   gitradar overwrite the file it points at.
 * - The new content goes to an exclusively created temp file with an unpredictable
 *   name next to the target, then is renamed over it, so a crash mid-write can never
 *   leave a truncated file and a pre-planted temp symlink is never followed.
 */
export async function writeFileAtomically(
  target: string,
  content: string,
  opts: { backup: boolean },
): Promise<void> {
  if (opts.backup) {
    const bak = `${target}.bak`;
    await rm(bak, { force: true });
    await copyFile(target, bak, constants.COPYFILE_EXCL);
  }
  const suffix = randomBytes(12).toString('base64url');
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${suffix}.tmp`);
  await writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
  await rename(tmp, target);
}
