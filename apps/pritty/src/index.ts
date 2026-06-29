/**
 * @jefelabs/pritty — public API for programmatic consumers.
 * Phase-1 surface: auth + config + categorizer. The commit/pr/rebase
 * orchestrators are added in follow-up phases.
 */

export {
  type CacheEntry,
  type CacheFile,
  clearCache,
  getCachedTicket,
  getCachePath,
  readCache,
  setCachedTicket,
} from './adapters/cache.js';
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
} from './adapters/index.js';
export {
  buildAdapter,
  type CommitMessage,
  type CommitSummary,
  generateCommitMessages,
  generatePR,
  generateRebasePlan,
  type PRDraft,
  type RebaseAction,
  type RebasePlan,
  type RebaseStep,
} from './ai.js';
export { getAuthPath, getAuthStore, login, logout, readAuth } from './auth.js';
export {
  type CategorizedFiles,
  type CategoryMap,
  categorize,
  DEFAULT_CATEGORIES,
  mergeCategories,
  UNKNOWN_CATEGORY,
} from './categorizer.js';
export {
  type CodeownersRule,
  findCodeowners,
  parseCodeowners,
  type ResolvedReviewers,
  resolveReviewers,
} from './codeowners.js';
export {
  type Config,
  ConfigSchema,
  defaultStarterConfig,
  loadConfig,
} from './config.js';
export { createGit, type GitOps, parseGitHubRemote } from './git.js';
export {
  addLabels,
  type CreatePROptions,
  createPR,
  getDefaultBranch,
  listOpenPRsForHead,
  type OpenPRSummary,
  type PRResult,
  requestReviewers,
} from './github.js';
export {
  findPullRequestTemplate,
  type PullRequestTemplate,
  templatePromptGuidance,
} from './pr-template.js';
export {
  detectTicket,
  findRecentTicket,
  type TicketConfig,
  ticketLink,
  ticketPromptGuidance,
} from './ticket.js';
