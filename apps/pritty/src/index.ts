/**
 * @agentx/pritty — public API for programmatic consumers.
 * Phase-1 surface: auth + config + categorizer. The commit/pr/rebase
 * orchestrators are added in follow-up phases.
 */

export { getAuthPath, getAuthStore, login, logout, readAuth } from "./auth.js";

export {
  type Config,
  ConfigSchema,
  defaultStarterConfig,
  loadConfig,
} from "./config.js";

export {
  type CategorizedFiles,
  type CategoryMap,
  DEFAULT_CATEGORIES,
  UNKNOWN_CATEGORY,
  categorize,
  mergeCategories,
} from "./categorizer.js";

export {
  type CommitMessage,
  buildAdapter,
  generateCommitMessages,
} from "./ai.js";

export { createGit, type GitOps } from "./git.js";
