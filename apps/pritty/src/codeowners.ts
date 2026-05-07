/**
 * CODEOWNERS reader + matcher. Resolves which users / teams should
 * be requested as reviewers based on the files a PR touches.
 *
 * GitHub conventions honored:
 *   - Resolution order: .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS
 *   - File format: `<glob-pattern> <owner1> <owner2> ...`
 *   - Owners: `@username`, `@org/team`, or `email@example.com`
 *   - Comments start with `#`; blank lines ignored
 *   - LAST matching rule wins (opposite of .gitignore's first-match)
 *   - Patterns are gitignore-style globs:
 *       - `*.ts` matches at any depth
 *       - `/foo` is root-relative
 *       - `dir/` matches everything under that directory
 *
 * What this module does NOT handle (yet):
 *   - Branch-specific CODEOWNERS (.github/CODEOWNERS@develop or similar)
 *   - Team membership resolution (we pass team slugs through; GitHub
 *     resolves them when requestReviewers is called)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { minimatch } from "minimatch";

const CODEOWNERS_PATHS: ReadonlyArray<string> = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

export interface CodeownersRule {
  /** Original glob pattern, as written in the file. */
  pattern: string;
  /** Owners listed for this pattern (with `@` prefix preserved). */
  owners: string[];
}

export interface ResolvedReviewers {
  /** Individual GitHub usernames (without `@`). */
  users: string[];
  /** Team slugs for org/team mentions (without `@org/` prefix). */
  teams: string[];
}

/**
 * Find and read the first existing CODEOWNERS file. Returns null when
 * none exists. Read errors are silently treated as "no CODEOWNERS"
 * — pritty falls back to creating PRs without auto-assigning reviewers.
 */
export function findCodeowners(cwd: string = process.cwd()): string | null {
  for (const rel of CODEOWNERS_PATHS) {
    const full = join(cwd, rel);
    if (!existsSync(full)) continue;
    try {
      return readFileSync(full, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Parse CODEOWNERS content into a list of rules. Comments and blank
 * lines are skipped. Lines without owners are skipped (they're often
 * deliberately set to "no one owns this" — we have nothing to do
 * with such files, so they don't appear in our rule list).
 */
export function parseCodeowners(content: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const [pattern, ...owners] = tokens;
    rules.push({ pattern, owners });
  }
  return rules;
}

/**
 * For each changed file, find the LAST matching rule (CODEOWNERS
 * convention) and collect its owners. Returns a deduped set split
 * into individual users and team slugs.
 */
export function resolveReviewers(
  changedFiles: readonly string[],
  rules: readonly CodeownersRule[],
): ResolvedReviewers {
  const allOwners = new Set<string>();
  for (const file of changedFiles) {
    let lastMatch: CodeownersRule | undefined;
    for (const rule of rules) {
      if (matchesPattern(file, rule.pattern)) lastMatch = rule;
    }
    if (lastMatch) {
      for (const owner of lastMatch.owners) allOwners.add(owner);
    }
  }

  const users: string[] = [];
  const teams: string[] = [];
  for (const owner of allOwners) {
    if (owner.startsWith("@")) {
      const stripped = owner.slice(1);
      if (stripped.includes("/")) {
        // @org/team → team slug
        const slug = stripped.split("/")[1];
        if (slug) teams.push(slug);
      } else {
        users.push(stripped);
      }
    }
    // Email-only owners (no @ prefix in tools' view) — GitHub PRs
    // can't request review by email directly; skip.
  }

  return { users: [...new Set(users)].sort(), teams: [...new Set(teams)].sort() };
}

/**
 * Translate CODEOWNERS-style globs to minimatch-style. CODEOWNERS
 * uses gitignore semantics:
 *   - patterns without `/` match at any depth
 *   - leading `/` makes the pattern root-relative
 *   - trailing `/` matches everything under that directory
 */
function matchesPattern(file: string, pattern: string): boolean {
  // Default options
  const opts = { dot: true, matchBase: false };

  // Normalize: strip leading slash → root-relative; minimatch matches
  // from beginning of input by default
  let p = pattern;
  if (p.startsWith("/")) {
    p = p.slice(1);
  } else if (!p.includes("/")) {
    // No slash anywhere → match at any depth (gitignore convention)
    return minimatch(file, p, { ...opts, matchBase: true });
  }

  // Trailing slash → directory match: prepend `**` to cover anything inside
  if (p.endsWith("/")) {
    p = `${p}**`;
  }

  return minimatch(file, p, opts);
}
