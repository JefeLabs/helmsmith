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
  type CommitSummary,
  type PRDraft,
  buildAdapter,
  generateCommitMessages,
  generatePR,
} from "./ai.js";

export { createGit, parseGitHubRemote, type GitOps } from "./git.js";

export {
  detectTicket,
  findRecentTicket,
  ticketLink,
  ticketPromptGuidance,
  type TicketConfig,
} from "./ticket.js";

export {
  findPullRequestTemplate,
  templatePromptGuidance,
  type PullRequestTemplate,
} from "./pr-template.js";

export {
  buildAdapter as buildTicketAdapter,
  deriveLinkTemplate,
  type JiraCliValidation,
  type JiraRestValidation,
  type LinearValidation,
  type TicketSystemAdapter,
  type ValidationConfig,
  type ValidationResult,
  type ValidationType,
} from "./adapters/index.js";

export {
  clearCache,
  getCachePath,
  getCachedTicket,
  readCache,
  setCachedTicket,
  type CacheEntry,
  type CacheFile,
} from "./adapters/cache.js";

export {
  type CreatePROptions,
  type OpenPRSummary,
  type PRResult,
  addLabels,
  createPR,
  getDefaultBranch,
  listOpenPRsForHead,
} from "./github.js";
