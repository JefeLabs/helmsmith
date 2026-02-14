import type { TaskNode } from '../config/schema.js';

// --- Keyword category definitions ---

const SCOPE_CATEGORIES: Record<string, readonly string[]> = {
  ui: ['ui', 'frontend', 'component', 'page', 'form', 'button', 'modal', 'layout', 'css', 'style', 'responsive', 'view'],
  backend: ['api', 'endpoint', 'server', 'route', 'middleware', 'controller', 'service', 'handler'],
  data: ['database', 'schema', 'migration', 'model', 'query', 'orm', 'sql', 'table', 'index', 'storage'],
  infrastructure: ['deploy', 'ci/cd', 'docker', 'kubernetes', 'monitoring', 'logging', 'pipeline', 'hosting'],
  authSecurity: ['auth', 'authentication', 'authorization', 'oauth', 'token', 'permission', 'encryption', 'rbac', 'cors'],
  testing: ['test', 'coverage', 'e2e', 'integration', 'unit', 'mock', 'fixture', 'assertion'],
} as const;

const DEPTH_CATEGORIES: Record<string, readonly string[]> = {
  infrastructure: ['deploy', 'ci/cd', 'docker', 'kubernetes', 'scaling', 'load balancer', 'cdn'],
  security: ['oauth', 'encryption', 'rbac', 'vulnerability', 'cors', 'token', 'credential', 'certificate'],
  performance: ['caching', 'optimization', 'load balancing', 'indexing', 'latency', 'throughput', 'profiling'],
  integration: ['api', 'webhook', 'third-party', 'sdk', 'protocol', 'upstream', 'downstream', 'external'],
  dataArchitecture: ['migration', 'schema design', 'replication', 'sharding', 'backup', 'etl'],
} as const;

const CROSS_CUTTING_INDICATORS: readonly string[] = [
  'across',
  'shared',
  'global',
  'system-wide',
  'end-to-end',
  'full-stack',
  'cross-cutting',
  'all modules',
  'every',
  'throughout',
  'both frontend and backend',
  'client and server',
  'multiple teams',
  'multiple modules',
  'multiple services',
] as const;

const VAGUENESS_INDICATORS: readonly string[] = [
  'various',
  'etc.',
  'some',
  'might',
  'possibly',
  'tbd',
  'todo',
  'maybe',
  'certain',
  'several',
  'few',
  'stuff',
  'things',
] as const;

const SPECIFICITY_PATTERNS: readonly RegExp[] = [
  /\d+/,                           // numbers
  /[\w-]+\.\w{1,5}/,              // file references (e.g., schema.ts, config.yaml)
  /[a-z][a-zA-Z]+[A-Z][a-zA-Z]*/, // camelCase identifiers
  /[a-z]+_[a-z]+/,                // snake_case identifiers
] as const;

const SPECIFICITY_VERBS: readonly string[] = [
  'implement',
  'create',
  'build',
  'add',
  'write',
  'configure',
  'set up',
  'define',
  'register',
  'install',
  'wire',
  'connect',
  'validate',
  'parse',
  'render',
] as const;

// --- Helper ---

function getTaskText(task: TaskNode): string {
  return `${task.title} ${task.description}`.toLowerCase();
}

/**
 * Check if a keyword appears in text as a whole word or phrase.
 * Multi-word keywords (e.g., "ci/cd", "load balancer") use includes().
 * Single words use word-boundary matching to avoid partial matches
 * (e.g., "ui" should not match inside "build").
 */
function keywordMatch(text: string, keyword: string): boolean {
  if (keyword.includes(' ') || keyword.includes('/')) {
    return text.includes(keyword);
  }
  const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return pattern.test(text);
}

function categoryMatches(text: string, categories: Record<string, readonly string[]>): number {
  const keys = Object.keys(categories);
  let matched = 0;
  for (const key of keys) {
    const keywords = categories[key];
    if (keywords.some((kw) => keywordMatch(text, kw))) {
      matched++;
    }
  }
  return matched;
}

// --- Dimension analyzers ---

/**
 * Scope Breadth: measures how many distinct technical areas a task covers.
 * Returns 0.0-1.0 based on ratio of matched categories to total categories.
 */
export function analyzeScopeBreadth(task: TaskNode): number {
  const text = getTaskText(task);
  const totalCategories = Object.keys(SCOPE_CATEGORIES).length;
  const matched = categoryMatches(text, SCOPE_CATEGORIES);
  return matched / totalCategories;
}

/**
 * Technical Depth: detects presence of infrastructure, security, performance,
 * integration, and data architecture concerns.
 * Returns 0.0-1.0 based on binary presence per category.
 */
export function analyzeTechnicalDepth(task: TaskNode): number {
  const text = getTaskText(task);
  const totalCategories = Object.keys(DEPTH_CATEGORIES).length;
  const matched = categoryMatches(text, DEPTH_CATEGORIES);
  return matched / totalCategories;
}

/**
 * Dependency Count: measures how connected a task is within the task graph.
 * Counts both outgoing dependencies and incoming references from other tasks.
 * Normalizes to 0.0-1.0, capped at 8 total connections.
 */
export function analyzeDependencyCount(task: TaskNode, allTasks: TaskNode[] = []): number {
  const outgoing = task.dependencies.length;

  // Count incoming: how many top-level tasks depend on this task
  let incoming = 0;
  for (const other of allTasks) {
    if (other.id === task.id) continue;
    if (other.dependencies.some((dep) => dep.taskId === task.id)) {
      incoming++;
    }
  }

  const totalConnections = outgoing + incoming;
  return Math.min(totalConnections / 8, 1.0);
}

/**
 * Ambiguity: measures vagueness of task requirements.
 * Higher score means more ambiguous. Empty description = 1.0.
 * Returns 0.0-1.0.
 */
export function analyzeAmbiguity(task: TaskNode): number {
  const description = task.description.trim();

  if (description === '') {
    return 1.0;
  }

  const text = getTaskText(task);

  // Count vagueness indicators
  let vagueness = 0;
  for (const indicator of VAGUENESS_INDICATORS) {
    if (keywordMatch(text, indicator)) {
      vagueness++;
    }
  }

  // Length penalty: short descriptions are inherently ambiguous
  if (description.length < 50) {
    vagueness += 2;
  }

  // Count specificity indicators
  let specificity = 0;
  for (const pattern of SPECIFICITY_PATTERNS) {
    if (pattern.test(text)) {
      specificity++;
    }
  }
  for (const verb of SPECIFICITY_VERBS) {
    if (keywordMatch(text, verb)) {
      specificity++;
    }
  }

  // Compute ratio
  const total = vagueness + specificity;
  if (total === 0) {
    return 0.5;
  }

  return vagueness / total;
}

/**
 * Cross-Cutting: detects whether a task spans multiple modules, teams, or systems.
 * Looks for boundary-crossing language and multi-area phrases.
 * Returns 0.0-1.0, capped at 5 matched indicators.
 */
export function analyzeCrossCutting(task: TaskNode): number {
  const text = getTaskText(task);

  let matched = 0;
  for (const indicator of CROSS_CUTTING_INDICATORS) {
    if (keywordMatch(text, indicator)) {
      matched++;
    }
  }

  return Math.min(matched / 5, 1.0);
}
