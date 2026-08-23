import { loadConfig } from '../config/loader.js';
import { assignAuthor, assignByIdentifierPrefix } from '../store/author-registry.js';
import {
  loadAuthorRegistrySQL,
  queryRecords,
  reattributeRecordsSQL,
  saveAuthorRegistrySQL,
} from '../store/sqlite-store.js';
import type { Config } from '../types/schema.js';

export interface AssignAuthorOptions {
  email: string;
  org: string;
  team: string;
  config?: string;
}

/**
 * Resolve the orgType/tag for an org/team pair from config.
 * Throws when the org isn't listed in `config.orgs`; falls back to tag
 * `'default'` when the org is known but the team isn't listed under it.
 */
export function resolveAssignment(
  config: Config,
  orgName: string,
  teamName: string,
): { orgType: 'core' | 'consultant'; tag: string } {
  const org = config.orgs.find((o) => o.name === orgName);
  if (!org) throw new Error(`Unknown org: ${orgName}`);
  const team = org.teams.find((t) => t.name === teamName);
  return { orgType: org.type, tag: team?.tag ?? 'default' };
}

/**
 * Resolve the display name to write onto re-attributed records: the config
 * member's name when a `config.orgs[].teams[].members[]` entry matches the
 * email (case-insensitive), else the given fallback (the registry author's name).
 */
function resolveMemberName(config: Config, email: string, fallback: string): string {
  const lower = email.toLowerCase();
  for (const org of config.orgs) {
    for (const team of org.teams) {
      for (const member of team.members) {
        if (member.email && member.email.toLowerCase() === lower) {
          return member.name;
        }
      }
    }
  }
  return fallback;
}

export async function assignAuthorCmd(options: AssignAuthorOptions): Promise<void> {
  const registry = loadAuthorRegistrySQL();
  const key = options.email.toLowerCase();
  const author = registry.authors[key];

  if (!author) {
    console.error(`Author not found: ${options.email}`);
    console.error('Run "gitradar list-authors" to see available authors.');
    process.exitCode = 1;
    return;
  }

  const updated = assignAuthor(registry, options.email, options.org, options.team);
  saveAuthorRegistrySQL(updated);

  // orgType/tag are derived from config.yml when it's available. If config.yml is
  // missing (loadConfig throws) or the org isn't listed there, fall back to orgType
  // 'core' / tag 'default' — the record is still re-attributed below, just without
  // config-derived org metadata.
  let orgType: 'core' | 'consultant' = 'core';
  let tag = 'default';
  let member = author.name;
  try {
    const config = await loadConfig(options.config);
    ({ orgType, tag } = resolveAssignment(config, options.org, options.team));
    member = resolveMemberName(config, key, author.name);
  } catch {
    // fall back to the defaults set above
  }

  // Re-attribute existing records via SQL UPDATE
  try {
    reattributeRecordsSQL([
      { email: key, member, org: options.org, orgType, team: options.team, tag },
    ]);
    const recordCount = queryRecords({}).length;
    console.log(`Assigned ${author.name} <${author.email}> → ${options.org} / ${options.team}`);
    console.log(`Re-attributed ${recordCount} records.`);
  } catch {
    console.log(`Assigned ${author.name} <${author.email}> → ${options.org} / ${options.team}`);
  }
}

export interface BulkAssignOptions {
  prefix: string;
  org: string;
  team: string;
  config?: string;
}

export async function bulkAssignCmd(options: BulkAssignOptions): Promise<void> {
  const registry = loadAuthorRegistrySQL();
  const result = assignByIdentifierPrefix(registry, options.prefix, options.org, options.team);
  saveAuthorRegistrySQL(result.registry);

  if (result.assignedCount === 0) {
    console.log(`No unassigned authors found with prefix "${options.prefix}".`);
    return;
  }

  // orgType/tag are derived from config.yml when it's available; same fallback as
  // assignAuthorCmd applies when config.yml is missing or the org isn't listed there.
  let orgType: 'core' | 'consultant' = 'core';
  let tag = 'default';
  let config: Config | undefined;
  try {
    config = await loadConfig(options.config);
    ({ orgType, tag } = resolveAssignment(config, options.org, options.team));
  } catch {
    // fall back to the defaults set above
  }

  // Re-attribute existing records via SQL UPDATE for all newly assigned authors
  const updates: Array<{
    email: string;
    member: string;
    org: string;
    orgType: string;
    team: string;
    tag: string;
  }> = [];
  for (const [email, author] of Object.entries(result.registry.authors)) {
    if (author.org === options.org && author.team === options.team) {
      updates.push({
        email,
        member: config ? resolveMemberName(config, email, author.name) : author.name,
        org: options.org,
        orgType,
        team: options.team,
        tag,
      });
    }
  }

  try {
    if (updates.length > 0) reattributeRecordsSQL(updates);
    console.log(
      `Assigned ${result.assignedCount} authors with prefix "${options.prefix}" → ${options.org} / ${options.team}`,
    );
    console.log(`Re-attributed records for ${updates.length} authors.`);
  } catch {
    console.log(
      `Assigned ${result.assignedCount} authors with prefix "${options.prefix}" → ${options.org} / ${options.team}`,
    );
  }
}
