import { readFile, writeFile, rename } from "node:fs/promises";
import type { AuthorRegistry, DiscoveredAuthor } from "../types/schema.js";
import { getAuthorRegistryPath, ensureDataDir } from "./paths.js";

/**
 * Extract identifier from a git author name.
 * Looks for a parenthesized code like "Edwin Cruz (CONEWC)" → "CONEWC".
 * Returns undefined if no identifier found.
 */
export function extractIdentifier(name: string): string | undefined {
  const match = name.match(/\(([A-Za-z0-9]+)\)/);
  return match ? match[1] : undefined;
}

/**
 * Load author registry from disk, or return an empty default.
 */
export async function loadAuthorRegistry(): Promise<AuthorRegistry> {
  try {
    const raw = await readFile(getAuthorRegistryPath(), "utf-8");
    return JSON.parse(raw) as AuthorRegistry;
  } catch {
    return { version: 1, authors: {} };
  }
}

/**
 * Atomically save author registry to disk.
 */
export async function saveAuthorRegistry(
  registry: AuthorRegistry,
): Promise<void> {
  await ensureDataDir();
  const filePath = getAuthorRegistryPath();
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
  await rename(tmpPath, filePath);
}

/**
 * Merge a batch of discovered authors into the registry.
 * Updates existing entries (bumps lastSeen, commitCount, reposSeenIn).
 * Returns the updated registry (does not mutate the input).
 */
export function mergeDiscoveredAuthors(
  registry: AuthorRegistry,
  discovered: Array<{
    email: string;
    name: string;
    repoName: string;
    commitCount: number;
    date: string;
  }>,
): AuthorRegistry {
  const authors = { ...registry.authors };

  for (const d of discovered) {
    const key = d.email.toLowerCase();
    const identifier = extractIdentifier(d.name);
    const existing = authors[key];

    if (existing) {
      // Update existing entry
      const reposSet = new Set(existing.reposSeenIn);
      reposSet.add(d.repoName);
      authors[key] = {
        ...existing,
        // Keep the most recent name (may have changed)
        name: d.name,
        identifier: identifier ?? existing.identifier,
        lastSeen: d.date > existing.lastSeen ? d.date : existing.lastSeen,
        reposSeenIn: [...reposSet],
        commitCount: existing.commitCount + d.commitCount,
      };
    } else {
      // New author
      authors[key] = {
        email: d.email,
        name: d.name,
        identifier,
        firstSeen: d.date,
        lastSeen: d.date,
        reposSeenIn: [d.repoName],
        commitCount: d.commitCount,
      };
    }
  }

  return { ...registry, authors };
}

/**
 * Assign an author to an org and team.
 * Returns the updated registry.
 */
export function assignAuthor(
  registry: AuthorRegistry,
  email: string,
  org: string,
  team: string,
): AuthorRegistry {
  const key = email.toLowerCase();
  const existing = registry.authors[key];
  if (!existing) return registry;

  return {
    ...registry,
    authors: {
      ...registry.authors,
      [key]: { ...existing, org, team },
    },
  };
}

/**
 * Bulk-assign all authors whose identifier starts with a given prefix.
 * Returns the updated registry and the count of authors assigned.
 */
export function assignByIdentifierPrefix(
  registry: AuthorRegistry,
  prefix: string,
  org: string,
  team: string,
): { registry: AuthorRegistry; assignedCount: number } {
  const upperPrefix = prefix.toUpperCase();
  const authors = { ...registry.authors };
  let assignedCount = 0;

  for (const [key, author] of Object.entries(authors)) {
    if (author.org) continue; // skip already-assigned

    const matches =
      (author.identifier && author.identifier.toUpperCase().startsWith(upperPrefix)) ||
      author.email.toUpperCase().includes(upperPrefix) ||
      author.name.toUpperCase().includes(upperPrefix);

    if (matches) {
      authors[key] = { ...author, org, team };
      assignedCount++;
    }
  }

  return { registry: { ...registry, authors }, assignedCount };
}

/**
 * Get all unassigned authors from the registry.
 */
export function getUnassignedAuthors(
  registry: AuthorRegistry,
): DiscoveredAuthor[] {
  return Object.values(registry.authors).filter((a) => !a.org);
}

/**
 * Get all assigned authors from the registry.
 */
export function getAssignedAuthors(
  registry: AuthorRegistry,
): DiscoveredAuthor[] {
  return Object.values(registry.authors).filter((a) => !!a.org);
}

/**
 * Get unique identifier prefixes found in the registry (first 2-3 chars of identifier).
 * Returns a map of prefix → count of authors with that prefix.
 */
export function getIdentifierPrefixes(
  registry: AuthorRegistry,
  prefixLength: number = 2,
): Map<string, { count: number; assigned: number; unassigned: number }> {
  const prefixes = new Map<
    string,
    { count: number; assigned: number; unassigned: number }
  >();

  for (const author of Object.values(registry.authors)) {
    if (!author.identifier) continue;
    const prefix = author.identifier.slice(0, prefixLength).toUpperCase();
    const entry = prefixes.get(prefix) ?? {
      count: 0,
      assigned: 0,
      unassigned: 0,
    };
    entry.count++;
    if (author.org) entry.assigned++;
    else entry.unassigned++;
    prefixes.set(prefix, entry);
  }

  return prefixes;
}
