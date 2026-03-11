import type { Config, AuthorRegistry, UserWeekRepoRecord } from "../types/schema.js";
import { extractIdentifier } from "../store/author-registry.js";

/**
 * A resolved author with full org/team/tag context.
 */
export interface ResolvedAuthor {
  member: string;
  email: string;
  org: string;
  orgType: "core" | "consultant";
  team: string;
  tag: string;
  /** GitHub username (without @) for PR/review metrics. */
  githubHandle?: string;
}

/**
 * Maps lowercase lookup keys (email, name, alias) to ResolvedAuthor.
 */
export type AuthorMap = Map<string, ResolvedAuthor>;

/**
 * Identifier prefix → org/team mapping for pattern-based resolution.
 */
interface IdentifierRule {
  prefix: string;
  org: string;
  orgType: "core" | "consultant";
  team: string;
  tag: string;
}

/**
 * Extended author map that also carries identifier rules and registry data.
 */
export interface AuthorMapBundle {
  map: AuthorMap;
  identifierRules: IdentifierRule[];
}

/**
 * Build an AuthorMap from a Config and optional AuthorRegistry.
 *
 * Resolution sources (in priority order):
 * 1. Config members: indexed by email, name, alias
 * 2. Author registry: assigned authors indexed by email
 * 3. Identifier rules: org.identifier prefix matching against git name
 */
export function buildAuthorMap(
  config: Config,
  authorRegistry?: AuthorRegistry,
): AuthorMap {
  const map: AuthorMap = new Map();

  // 1. Index config members (highest priority)
  for (const org of config.orgs) {
    for (const team of org.teams) {
      for (const member of team.members) {
        const resolved: ResolvedAuthor = {
          member: member.name,
          email: member.email ?? "",
          org: org.name,
          orgType: org.type,
          team: team.name,
          tag: team.tag,
          githubHandle: member.githubHandle,
        };

        // Index by name (lowercase)
        map.set(member.name.toLowerCase(), resolved);

        // Index by email (lowercase) if present
        if (member.email) {
          map.set(member.email.toLowerCase(), resolved);
        }

        // Index by each alias (lowercase)
        if (member.aliases) {
          for (const alias of member.aliases) {
            map.set(alias.toLowerCase(), resolved);
          }
        }
      }
    }
  }

  // 2. Index author registry (assigned authors only, lower priority than config)
  if (authorRegistry) {
    for (const [emailKey, author] of Object.entries(authorRegistry.authors)) {
      if (!author.org || !author.team) continue;
      if (map.has(emailKey)) continue; // config takes precedence

      // Find the org to get orgType and tag
      const org = config.orgs.find((o) => o.name === author.org);
      const team = org?.teams.find((t) => t.name === author.team);

      if (org && team) {
        const resolved: ResolvedAuthor = {
          member: author.name,
          email: author.email,
          org: org.name,
          orgType: org.type,
          team: team.name,
          tag: team.tag,
          githubHandle: author.githubHandle,
        };
        map.set(emailKey, resolved);
      }
    }
  }

  return map;
}

/**
 * Build identifier rules from config orgs that have an `identifier` prefix.
 */
export function buildIdentifierRules(config: Config): IdentifierRule[] {
  const rules: IdentifierRule[] = [];
  for (const org of config.orgs) {
    if (!org.identifier) continue;
    // Use first team as default assignment target
    const defaultTeam = org.teams[0];
    if (!defaultTeam) continue;
    rules.push({
      prefix: org.identifier.toUpperCase(),
      org: org.name,
      orgType: org.type,
      team: defaultTeam.name,
      tag: defaultTeam.tag,
    });
  }
  return rules;
}

/**
 * Resolve an author by email (first), name (second), or identifier pattern (third).
 * All lookups are case-insensitive. Returns null if unmatched.
 */
export function resolveAuthor(
  map: AuthorMap,
  email: string,
  name: string,
  identifierRules?: IdentifierRule[],
): ResolvedAuthor | null {
  // 1. Direct email or name lookup
  const direct =
    map.get(email.toLowerCase()) ?? map.get(name.toLowerCase()) ?? null;
  if (direct) return direct;

  // 2. Identifier-based resolution
  if (identifierRules && identifierRules.length > 0) {
    const identifier = extractIdentifier(name);
    if (identifier) {
      const upper = identifier.toUpperCase();
      for (const rule of identifierRules) {
        if (upper.startsWith(rule.prefix)) {
          return {
            member: name,
            email,
            org: rule.org,
            orgType: rule.orgType,
            team: rule.team,
            tag: rule.tag,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Re-attribute existing records using the current author map.
 * Updates org, orgType, team, tag, and member on each record
 * where the resolved author differs from what's stored.
 * Returns a new array (does not mutate the input).
 */
export function reattributeRecords(
  records: UserWeekRepoRecord[],
  config: Config,
  authorRegistry?: AuthorRegistry,
): UserWeekRepoRecord[] {
  const map = buildAuthorMap(config, authorRegistry);
  const rules = buildIdentifierRules(config);

  return records.map((r) => {
    const resolved = resolveAuthor(map, r.email, r.member, rules);

    if (!resolved) {
      // Author not in the map — check if they're explicitly unassigned in the registry.
      // If so, force record to unassigned (don't keep stale org/team from disk).
      if (authorRegistry) {
        const regEntry = authorRegistry.authors[r.email.toLowerCase()];
        if (regEntry && !regEntry.org && r.org !== 'unassigned') {
          return { ...r, org: 'unassigned', orgType: 'core' as const, team: 'unassigned', tag: 'default' };
        }
      }
      return r;
    }

    if (
      resolved.org === r.org &&
      resolved.orgType === r.orgType &&
      resolved.team === r.team &&
      resolved.tag === r.tag
    ) {
      return r;
    }
    return {
      ...r,
      member: resolved.member,
      org: resolved.org,
      orgType: resolved.orgType,
      team: resolved.team,
      tag: resolved.tag,
    };
  });
}
