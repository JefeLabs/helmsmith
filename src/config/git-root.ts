import { simpleGit } from "simple-git";

/**
 * Detect the git repository root from the given directory (or cwd).
 * Returns null if not inside a git repository.
 */
export async function detectGitRoot(cwd?: string): Promise<string | null> {
  const git = simpleGit(cwd ?? process.cwd());
  try {
    const root = await git.revparse(["--show-toplevel"]);
    return root.trim();
  } catch {
    return null;
  }
}
