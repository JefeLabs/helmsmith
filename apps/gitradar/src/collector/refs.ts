import { simpleGit } from 'simple-git';

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * The commit HEAD points at, or null for an empty repo. Resolved before a scan so a
 * commit that lands mid-scan is picked up by the next one (#79).
 */
export async function resolveHead(repoPath: string): Promise<string | null> {
  try {
    const out = (
      await simpleGit(repoPath).raw(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
    ).trim();
    return SHA_RE.test(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * True when `ancestor` is reachable from `descendant`. False on a rewritten history
 * (force-push, branch switch), and for anything that is not a SHA — nothing but SHAs
 * ever reaches git here, so no ref name can be parsed as an option.
 */
export async function isAncestor(
  repoPath: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  if (!SHA_RE.test(ancestor) || !SHA_RE.test(descendant)) return false;
  try {
    await simpleGit(repoPath).raw(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false; // exit 1: not an ancestor (or git failed; a full walk is the safe answer)
  }
}
