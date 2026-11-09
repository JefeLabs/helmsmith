/**
 * Where the manifest was found:
 * - `repo`: the repo-local config dir under the git root.
 * - `workspace`: a `gittyup.yaml` found by walking up from the working directory.
 * - `home`: the global config dir (`~/.helmsmith/gittyup`).
 */
export type ConfigLocation = 'home' | 'repo' | 'workspace';

export interface ResolvedConfig {
  location: ConfigLocation;
  configDir: string;
  manifestPath: string;
  gitRoot: string | null;
}
