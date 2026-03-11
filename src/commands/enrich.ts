import { GitRadarEngine } from "../engine/gitradar-engine.js";
import { loadConfig } from "../config/loader.js";
import { detectGitRoot } from "../config/git-root.js";
import { loadAllRegistries, getAvailableWorkspaces } from "../config/repos-registry.js";

export interface EnrichOptions {
  weeks?: number;
  repo?: string;
  force?: boolean;
  skipChurn?: boolean;
  /** Use full per-file git blame churn analysis (slower, more precise). Default: fast heuristic. */
  deepChurn?: boolean;
  config?: string;
  workspace?: string;
  /** Max concurrent GitHub API requests per repo (default: 5). */
  concurrency?: number;
  /** Bypass the local GitHub API response cache. */
  skipCache?: boolean;
}

/**
 * Standalone enrich command — creates an engine, loads state, and enriches.
 *
 * When enrichment runs as part of `runMain`, the engine already has config,
 * records, and author registry loaded. This function handles the standalone
 * case where the user runs `gitradar enrich` directly.
 */
export async function enrich(options: EnrichOptions): Promise<void> {
  const engine = new GitRadarEngine();

  // Load config with workspace repos
  const config = await loadConfig(options.config);

  if (config.repos.length === 0) {
    const gitRoot = await detectGitRoot();
    const registries = await loadAllRegistries(gitRoot ?? undefined);
    const workspaces = getAvailableWorkspaces(registries);
    const ws = options.workspace
      ? workspaces.find((w) => w.name === options.workspace)
      : workspaces[0];
    if (ws) {
      config.repos = ws.repos.map((r) => ({
        path: r.path ?? '',
        name: r.name,
        group: r.group,
      }));
    }
  }

  engine.config = config;
  await engine.loadStores();

  await engine.enrich({
    weeks: options.weeks,
    repo: options.repo,
    force: options.force,
    skipChurn: options.skipChurn,
    deepChurn: options.deepChurn,
    concurrency: options.concurrency,
    skipCache: options.skipCache,
  });
}
