/**
 * @helmsmith/pritty/core — the deterministic pieces, for in-process consumers
 * such as workbrokr: git, GitHub, token resolution, PR template, CODEOWNERS,
 * config, attribution and redaction. No AI adapters, no prompts, no TUI, so
 * importing this never loads OpenAI, Anthropic, OpenTUI or inquirer.
 */

export {
  type CodeownersRule,
  findCodeowners,
  parseCodeowners,
  type ResolvedReviewers,
  resolveReviewers,
} from './codeowners.js';
export { applyFooter, applyTrailers } from './commands/_shared/attribution.js';
export { type BaseSource, resolveBaseBranch } from './commands/_shared/base.js';
export { inferLabels } from './commands/_shared/labels.js';
export { type Config, ConfigSchema, defaultStarterConfig, loadConfig } from './config.js';
export { createGit, describeRemote, type GitOps, parseGitHubRemote } from './git.js';
export {
  addLabels,
  assertGitHubToken,
  type CreatePROptions,
  createPR,
  getDefaultBranch,
  listOpenPRs,
  listOpenPRsForHead,
  type OpenPRSummary,
  type PRPatch,
  type PRResult,
  requestReviewers,
  updatePR,
} from './github.js';
export {
  defaultTokenResolveOptions,
  type ResolvedToken,
  resolveGitHubToken,
  type TokenResolveOptions,
} from './github-token.js';
export { findPullRequestTemplate, type PullRequestTemplate } from './pr-template.js';
export { redactDiff, withTimeout } from './redact.js';
export { repoRoot, searchDirs } from './repo-root.js';
