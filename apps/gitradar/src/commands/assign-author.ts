import { loadConfig } from '../config/loader.js';
import { assignAuthor, assignByIdentifierPrefix } from '../store/author-registry.js';
import {
  loadAuthorRegistrySQL,
  reattributeRecordsSQL,
  saveAuthorRegistrySQL,
} from '../store/sqlite-store.js';
import type { AuthorRegistry, Config } from '../types/schema.js';

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

export type ReattributionPlan =
  | { ok: true; orgType: 'core' | 'consultant'; tag: string; member: string }
  | { ok: false; error: string };

/**
 * Pure decision for how to re-attribute an author's records for an org/team assignment.
 *
 * - `config` undefined (the caller passes this when `loadConfig` threw — e.g. config.yml
 *   is missing) → falls back to orgType `'core'` / tag `'default'` / the given
 *   `fallbackMemberName`, since there's no config to derive anything from. This is an
 *   environment gap, not a user mistake, so it degrades gracefully.
 * - `config` available but the org isn't listed in it → fails (`ok: false`) rather than
 *   falling back, since that's a distinct, actionable mistake (a typo'd or not-yet-added
 *   org) that should stop the assignment, not silently persist made-up org metadata.
 * - `config` available and the org is known → derives orgType/tag via `resolveAssignment`
 *   and `member` via `resolveMemberName`.
 */
export function planReattribution(
  config: Config | undefined,
  email: string,
  fallbackMemberName: string,
  orgName: string,
  teamName: string,
): ReattributionPlan {
  if (!config) {
    return { ok: true, orgType: 'core', tag: 'default', member: fallbackMemberName };
  }
  try {
    const { orgType, tag } = resolveAssignment(config, orgName, teamName);
    return { ok: true, orgType, tag, member: resolveMemberName(config, email, fallbackMemberName) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One row of the argument `reattributeRecordsSQL` takes. */
export interface ReattributionUpdate {
  email: string;
  member: string;
  org: string;
  orgType: string;
  team: string;
  tag: string;
}

/**
 * Build the `reattributeRecordsSQL` updates for a TUI assignment, so the TUI
 * rewrites stored records exactly the way `author assign` does.
 *
 * `org`/`team` undefined means an unassign: records go to the same
 * `unassigned` / `core` / `default` attribution the in-memory
 * `reattributeRecords` pass writes. The display name still comes from
 * `resolveMemberName`, because that is the name a fresh scan would produce.
 *
 * Emails the registry does not know, and orgs the config does not list, are
 * skipped — the TUI only offers configured orgs, so the latter is a guard.
 */
export function buildTuiReattribution(
  config: Config,
  registry: AuthorRegistry,
  emails: string[],
  org: string | undefined,
  team: string | undefined,
): ReattributionUpdate[] {
  const updates: ReattributionUpdate[] = [];
  for (const raw of emails) {
    const email = raw.toLowerCase();
    const author = registry.authors[email];
    if (!author) continue;

    if (!org || !team) {
      updates.push({
        email,
        member: resolveMemberName(config, email, author.name),
        org: 'unassigned',
        orgType: 'core',
        team: 'unassigned',
        tag: 'default',
      });
      continue;
    }

    const plan = planReattribution(config, email, author.name, org, team);
    if (!plan.ok) continue;
    updates.push({
      email,
      member: plan.member,
      org,
      orgType: plan.orgType,
      team,
      tag: plan.tag,
    });
  }
  return updates;
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

  // orgType/tag/member are derived from config.yml when it's available. A missing
  // config.yml (loadConfig throws) falls back to orgType 'core' / tag 'default' / the
  // registry name — an environment gap, not a user mistake. An org that's simply not
  // listed in an available config is a distinct, actionable mistake: bail out before
  // touching the registry or records at all, rather than silently persisting a made-up
  // org. See `planReattribution` for the full decision.
  let config: Config | undefined;
  try {
    config = await loadConfig(options.config);
  } catch {
    // config.yml unavailable — planReattribution falls back to core/default below.
  }
  const plan = planReattribution(config, key, author.name, options.org, options.team);
  if (!plan.ok) {
    console.error(`Error: Unknown org "${options.org}" — add it with "gitradar org add" first`);
    process.exitCode = 1;
    return;
  }

  const updated = assignAuthor(registry, options.email, options.org, options.team);
  saveAuthorRegistrySQL(updated);
  console.log(`Assigned ${author.name} <${author.email}> → ${options.org} / ${options.team}`);

  // Re-attribute existing records via SQL UPDATE. The registry is already saved,
  // so a store failure here leaves the two out of sync — report it and exit
  // non-zero rather than printing a bare success line the caller can't distinguish.
  try {
    const rewritten = reattributeRecordsSQL([
      {
        email: key,
        member: plan.member,
        org: options.org,
        orgType: plan.orgType,
        team: options.team,
        tag: plan.tag,
      },
    ]);
    console.log(`Re-attributed ${rewritten} ${rewritten === 1 ? 'record' : 'records'}.`);
  } catch (err) {
    console.error(
      `Error: re-attributing stored records failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error('The assignment was saved — re-run this command to retry the re-attribution.');
    process.exitCode = 1;
  }
}

export interface BulkAssignOptions {
  prefix: string;
  org: string;
  team: string;
  config?: string;
}

export async function bulkAssignCmd(options: BulkAssignOptions): Promise<void> {
  // orgType/tag are derived from config.yml when it's available — same fallback and
  // unknown-org handling as assignAuthorCmd (see `planReattribution`): a missing
  // config.yml falls back to orgType 'core' / tag 'default', but an org that's simply
  // not listed in an available config is an actionable mistake — bail out before
  // touching the registry or records at all.
  let orgType: 'core' | 'consultant' = 'core';
  let tag = 'default';
  let config: Config | undefined;
  try {
    config = await loadConfig(options.config);
  } catch {
    // config.yml unavailable — fall back to the defaults set above.
  }
  if (config) {
    try {
      ({ orgType, tag } = resolveAssignment(config, options.org, options.team));
    } catch {
      console.error(`Error: Unknown org "${options.org}" — add it with "gitradar org add" first`);
      process.exitCode = 1;
      return;
    }
  }

  const registry = loadAuthorRegistrySQL();
  // Captured before the pass so the re-attribution — and the count reported for
  // it — cover the authors this command actually assigned, not everyone who
  // already sat in the target org/team.
  const alreadyAssigned = new Set(
    Object.entries(registry.authors)
      .filter(([, a]) => !!a.org)
      .map(([email]) => email),
  );
  const result = assignByIdentifierPrefix(registry, options.prefix, options.org, options.team);
  saveAuthorRegistrySQL(result.registry);

  if (result.assignedCount === 0) {
    console.log(`No unassigned authors found with prefix "${options.prefix}".`);
    return;
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
    if (alreadyAssigned.has(email)) continue;
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

  console.log(
    `Assigned ${result.assignedCount} authors with prefix "${options.prefix}" → ${options.org} / ${options.team}`,
  );

  try {
    const rewritten = updates.length > 0 ? reattributeRecordsSQL(updates) : 0;
    console.log(
      `Re-attributed ${rewritten} ${rewritten === 1 ? 'record' : 'records'} for ${updates.length} ${updates.length === 1 ? 'author' : 'authors'}.`,
    );
  } catch (err) {
    console.error(
      `Error: re-attributing stored records failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error('The assignments were saved — re-run this command to retry the re-attribution.');
    process.exitCode = 1;
  }
}
