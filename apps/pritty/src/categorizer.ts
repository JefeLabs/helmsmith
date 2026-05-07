/**
 * File categorization — first-match-wins glob matching against a
 * configurable category map. Defaults cover the common buckets (app,
 * test, infra, storybook, config); user config can override or
 * extend.
 *
 * The PRD describes additional context detection (language, framework,
 * isTest, isConfig, isInfra) — that lands in a follow-up phase. v1
 * stops at "which category does this file belong to?".
 */

import { minimatch } from "minimatch";

export interface CategoryMap {
  [category: string]: string[];
}

/**
 * Built-in defaults — match the PRD's category table. User entries
 * override per-key (a custom `app` replaces the default `app`).
 * To add to a default category, copy its patterns and append.
 */
export const DEFAULT_CATEGORIES: CategoryMap = {
  app: [
    "src/**",
    "lib/**",
    "app/**",
    "pages/**",
    "components/**",
    "hooks/**",
    "utils/**",
  ],
  test: [
    "test/**",
    "tests/**",
    "__tests__/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.*",
  ],
  infra: [
    "terraform/**",
    ".github/**",
    "Dockerfile*",
    "docker-compose*",
    "k8s/**",
    "helm/**",
    ".gitlab-ci*",
    ".circleci/**",
  ],
  storybook: ["**/*.stories.*", "**/*.story.*", ".storybook/**"],
  config: [
    "*.config.*",
    "package.json",
    "tsconfig*",
    ".eslintrc*",
    ".prettierrc*",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
  ],
};

/** Bucket that catches files matching no configured category. */
export const UNKNOWN_CATEGORY = "unknown";

export interface CategorizedFiles {
  [category: string]: string[];
}

/**
 * Bucket files by category. First-match-wins — entries are checked
 * in CategoryMap iteration order, so callers should put the more
 * specific categories before the broad ones (e.g. `test` before
 * `app` — otherwise `src/foo.test.ts` would land in `app` first).
 *
 * Files matching no category go into `unknown`.
 */
export function categorize(
  files: readonly string[],
  categories: CategoryMap = DEFAULT_CATEGORIES,
): CategorizedFiles {
  const out: CategorizedFiles = {};
  // Pre-create empty buckets so the result shape includes every
  // configured category, even with zero files.
  for (const name of Object.keys(categories)) {
    out[name] = [];
  }
  out[UNKNOWN_CATEGORY] = [];

  for (const file of files) {
    let matched = false;
    for (const [category, patterns] of Object.entries(categories)) {
      if (patterns.some((p) => minimatch(file, p, { dot: true }))) {
        out[category]!.push(file);
        matched = true;
        break;
      }
    }
    if (!matched) out[UNKNOWN_CATEGORY]!.push(file);
  }

  return out;
}

/**
 * Merge user category config over the built-in defaults. Same shape
 * as Object.assign — same-key entries fully replace, no glob-list
 * merging. (The PRD allows custom categories to "merge with/override
 * defaults"; treating `categories[<name>]` as a full replacement is
 * the simpler semantic and matches typical config conventions.)
 */
export function mergeCategories(
  user: CategoryMap | undefined,
  defaults: CategoryMap = DEFAULT_CATEGORIES,
): CategoryMap {
  if (!user) return defaults;
  return { ...defaults, ...user };
}
