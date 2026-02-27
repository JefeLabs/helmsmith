import chalk from 'chalk';
import type { ViewContext } from './types.js';
import type { ScanState } from '../types/schema.js';
import { renderTable } from '../ui/table.js';
import { fmt } from '../ui/format.js';
import { isStale } from '../store/scan-state.js';
import { getIdentifierPrefixes } from '../store/author-registry.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ManageSection = 'repos' | 'orgs' | 'authors' | 'groups' | 'tags';

export const MANAGE_SECTIONS: ManageSection[] = ['repos', 'orgs', 'authors', 'groups', 'tags'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function scanStatus(
  repoName: string,
  scanState: ScanState | undefined,
  stalenessMinutes: number,
): { status: string; colored: string } {
  if (!scanState) return { status: 'unknown', colored: chalk.dim('unknown') };
  const repoState = scanState.repos[repoName];
  if (!repoState) return { status: 'never', colored: chalk.yellow('never scanned') };
  const stale = isStale(repoState, stalenessMinutes);
  const ago = timeAgo(repoState.lastScanDate);
  if (stale) return { status: 'stale', colored: chalk.yellow(`stale (${ago})`) };
  return { status: 'fresh', colored: chalk.green(`fresh (${ago})`) };
}

// ── Section renderers ────────────────────────────────────────────────────────

export function renderReposSection(
  ctx: ViewContext,
  termCols: number,
  selectedIdx?: number,
): { output: string; repoNames: string[] } {
  const scanState = ctx.scanState;
  const stalenessMinutes = ctx.config.settings.staleness_minutes;
  const repoNames: string[] = [];

  const rows: Record<string, any>[] = [];
  for (const repo of ctx.config.repos) {
    const name = repo.name ?? repo.path.split('/').pop() ?? repo.path;
    repoNames.push(name);
    const repoState = scanState?.repos[name];
    const { colored } = scanStatus(name, scanState, stalenessMinutes);
    const isSelected = selectedIdx !== undefined && rows.length === selectedIdx;

    rows.push({
      cursor: isSelected ? chalk.cyan('\u25B6') : ' ',
      name: isSelected ? chalk.cyan.bold(name) : name,
      group: repo.group,
      path: repo.path,
      records: repoState?.recordCount ?? 0,
      scanStatus: colored,
    });
  }

  const table = renderTable({
    columns: [
      { key: 'cursor', label: ' ', minWidth: 1 },
      { key: 'name', label: 'Repo', minWidth: 14 },
      { key: 'group', label: 'Group', minWidth: 8 },
      { key: 'records', label: 'Records', align: 'right', minWidth: 7, format: (v) => fmt(v) },
      { key: 'scanStatus', label: 'Scan Status', minWidth: 18 },
      { key: 'path', label: 'Path', minWidth: 10 },
    ],
    rows,
    maxWidth: termCols,
  });

  return { output: table, repoNames };
}

export function renderOrgsSection(
  ctx: ViewContext,
  termCols: number,
): string {
  const rows: Record<string, any>[] = [];
  const groupSeparators: number[] = [];

  for (let oi = 0; oi < ctx.config.orgs.length; oi++) {
    const org = ctx.config.orgs[oi];
    const prefix = org.type === 'core' ? '\u2605' : '\u25C6';
    const idLabel = org.identifier ? chalk.cyan(org.identifier) : chalk.dim('-');

    for (const team of org.teams) {
      rows.push({
        org: `${prefix} ${org.name}`,
        type: org.type,
        identifier: idLabel,
        team: team.name,
        tag: team.tag,
        members: team.members.length,
      });
    }

    if (oi < ctx.config.orgs.length - 1 && rows.length > 0) {
      groupSeparators.push(rows.length - 1);
    }
  }

  if (rows.length === 0) {
    return chalk.dim('  No organizations configured.');
  }

  return renderTable({
    columns: [
      { key: 'org', label: 'Organization', minWidth: 14 },
      { key: 'type', label: 'Type', minWidth: 10 },
      { key: 'identifier', label: 'ID Prefix', minWidth: 9 },
      { key: 'team', label: 'Team', minWidth: 12 },
      { key: 'tag', label: 'Tag', minWidth: 8 },
      { key: 'members', label: 'Members', align: 'right', minWidth: 7 },
    ],
    rows,
    maxWidth: termCols,
    groupSeparator: groupSeparators,
  });
}

/** A merged view of one or more registry entries sharing the same display name. */
interface MergedAuthor {
  name: string;
  emails: string[];
  identifier?: string;
  org?: string;
  team?: string;
  commitCount: number;
  repoCount: number;
}

function mergeAuthorsByName(
  registry: import('../types/schema.js').AuthorRegistry,
): MergedAuthor[] {
  const byName = new Map<string, MergedAuthor & { _repos: Set<string> }>();

  for (const author of Object.values(registry.authors)) {
    const key = author.name.toLowerCase();
    const existing = byName.get(key);

    if (existing) {
      existing.emails.push(author.email);
      existing.commitCount += author.commitCount;
      for (const repo of author.reposSeenIn) existing._repos.add(repo);
      existing.repoCount = existing._repos.size;
      if (!existing.identifier && author.identifier) {
        existing.identifier = author.identifier;
      }
      if (!existing.org && author.org) {
        existing.org = author.org;
        existing.team = author.team;
      }
    } else {
      byName.set(key, {
        name: author.name,
        emails: [author.email],
        identifier: author.identifier,
        org: author.org,
        team: author.team,
        commitCount: author.commitCount,
        repoCount: author.reposSeenIn.length,
        _repos: new Set(author.reposSeenIn),
      });
    }
  }

  return [...byName.values()];
}

export function renderAuthorsSection(
  ctx: ViewContext,
  termCols: number,
  selectedIdx?: number,
): { output: string; authorEmailGroups: string[][] } {
  const registry = ctx.authorRegistry;
  if (!registry || Object.keys(registry.authors).length === 0) {
    return { output: chalk.dim('  No authors discovered yet. Scan repos first.'), authorEmailGroups: [] };
  }

  const merged = mergeAuthorsByName(registry);
  // Sort: unassigned first, then by commit count descending
  merged.sort((a, b) => {
    if (!a.org && b.org) return -1;
    if (a.org && !b.org) return 1;
    return b.commitCount - a.commitCount;
  });

  const authorEmailGroups: string[][] = [];
  const rows: Record<string, any>[] = [];
  const groupSeparators: number[] = [];
  let lastWasUnassigned = true;

  for (const author of merged) {
    const isUnassigned = !author.org;
    authorEmailGroups.push(author.emails);

    // Add separator between unassigned and assigned sections
    if (!isUnassigned && lastWasUnassigned && rows.length > 0) {
      groupSeparators.push(rows.length - 1);
    }
    lastWasUnassigned = isUnassigned;

    const isSelected = selectedIdx !== undefined && rows.length === selectedIdx;
    const emailHint = author.emails.length > 1 ? chalk.dim(` (${author.emails.length} emails)`) : '';

    rows.push({
      cursor: isSelected ? chalk.cyan('\u25B6') : ' ',
      name: (isSelected ? chalk.cyan.bold(author.name) : author.name) + emailHint,
      identifier: author.identifier ? chalk.cyan(author.identifier) : chalk.dim('-'),
      org: author.org ?? chalk.yellow('unassigned'),
      team: author.team ?? chalk.dim('-'),
      commits: author.commitCount,
      repos: author.repoCount,
    });
  }

  const table = renderTable({
    columns: [
      { key: 'cursor', label: ' ', minWidth: 1 },
      { key: 'name', label: 'Name', minWidth: 18 },
      { key: 'identifier', label: 'ID', minWidth: 8 },
      { key: 'org', label: 'Org', minWidth: 12 },
      { key: 'team', label: 'Team', minWidth: 10 },
      { key: 'commits', label: 'Commits', align: 'right', minWidth: 7, format: (v) => fmt(v) },
      { key: 'repos', label: 'Repos', align: 'right', minWidth: 5 },
    ],
    rows,
    maxWidth: termCols,
    groupSeparator: groupSeparators,
  });

  // Identifier prefix summary
  const prefixes = getIdentifierPrefixes(registry);
  let prefixSummary = '';
  if (prefixes.size > 0) {
    const parts: string[] = [];
    for (const [prefix, info] of [...prefixes.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const status = info.unassigned > 0
        ? chalk.yellow(`${info.unassigned} unassigned`)
        : chalk.green('all assigned');
      parts.push(`${chalk.cyan(prefix)}: ${info.count} authors (${status})`);
    }
    prefixSummary = '\n' + chalk.dim('  Identifier prefixes: ') + parts.join(chalk.dim('  \u00b7  '));
  }

  const uniqueAuthors = merged.length;
  const totalEmails = Object.keys(registry.authors).length;
  const assigned = merged.filter((a) => !!a.org).length;
  const unassigned = uniqueAuthors - assigned;

  const footer = table + '\n' +
    chalk.dim('  ') +
    chalk.green(`${assigned} assigned`) + chalk.dim('  ') +
    chalk.yellow(`${unassigned} unassigned`) + chalk.dim(`  (${uniqueAuthors} authors, ${totalEmails} emails)`) +
    prefixSummary;

  return { output: footer, authorEmailGroups };
}

export function renderGroupsSection(
  ctx: ViewContext,
  termCols: number,
): string {
  const groups = ctx.config.groups ?? {};
  const groupNames = Object.keys(groups);

  // Count repos per group
  const repoCounts = new Map<string, number>();
  for (const repo of ctx.config.repos) {
    const g = repo.group;
    repoCounts.set(g, (repoCounts.get(g) ?? 0) + 1);
  }

  // Include groups from repos that aren't defined in config.groups
  for (const [g] of repoCounts) {
    if (!groupNames.includes(g)) groupNames.push(g);
  }

  if (groupNames.length === 0) {
    return chalk.dim('  No groups defined.');
  }

  const rows: Record<string, any>[] = groupNames.map((name) => ({
    name,
    label: groups[name]?.label ?? chalk.dim('(none)'),
    repos: repoCounts.get(name) ?? 0,
  }));

  return renderTable({
    columns: [
      { key: 'name', label: 'Group', minWidth: 12 },
      { key: 'label', label: 'Label', minWidth: 14 },
      { key: 'repos', label: 'Repos', align: 'right', minWidth: 5 },
    ],
    rows,
    maxWidth: termCols,
  });
}

export function renderTagsSection(
  ctx: ViewContext,
  termCols: number,
): string {
  const tags = ctx.config.tags ?? {};
  const tagNames = Object.keys(tags);

  // Count teams per tag
  const teamCounts = new Map<string, number>();
  for (const org of ctx.config.orgs) {
    for (const team of org.teams) {
      const t = team.tag;
      teamCounts.set(t, (teamCounts.get(t) ?? 0) + 1);
    }
  }

  // Include tags from teams that aren't in config.tags
  for (const [t] of teamCounts) {
    if (!tagNames.includes(t)) tagNames.push(t);
  }

  if (tagNames.length === 0) {
    return chalk.dim('  No tags defined.');
  }

  const rows: Record<string, any>[] = tagNames.map((name) => ({
    name,
    label: tags[name]?.label ?? chalk.dim('(none)'),
    teams: teamCounts.get(name) ?? 0,
  }));

  return renderTable({
    columns: [
      { key: 'name', label: 'Tag', minWidth: 12 },
      { key: 'label', label: 'Label', minWidth: 14 },
      { key: 'teams', label: 'Teams', align: 'right', minWidth: 5 },
    ],
    rows,
    maxWidth: termCols,
  });
}

// ── Full render ──────────────────────────────────────────────────────────────

export function renderManageTab(
  ctx: ViewContext,
  activeSection: ManageSection,
  termCols: number,
  selectedRepoIdx?: number,
  selectedAuthorIdx?: number,
): { repoNames: string[]; authorEmailGroups: string[][] } {
  const sectionLabel = activeSection === 'repos' ? 'Repositories & Scan State'
    : activeSection === 'orgs' ? 'Organizations & Teams'
    : activeSection === 'authors' ? 'Discovered Authors'
    : activeSection === 'groups' ? 'Repo Groups'
    : 'Tags';

  console.log(chalk.bold(sectionLabel));
  console.log('');

  let repoNames: string[] = [];
  let authorEmailGroups: string[][] = [];

  switch (activeSection) {
    case 'repos': {
      const result = renderReposSection(ctx, termCols, selectedRepoIdx);
      console.log(result.output);
      repoNames = result.repoNames;

      // Scan summary footer
      const scanState = ctx.scanState;
      if (scanState) {
        const totalRepos = ctx.config.repos.length;
        const stalenessMin = ctx.config.settings.staleness_minutes;
        let freshCount = 0;
        let staleCount = 0;
        let neverCount = 0;
        for (const repo of ctx.config.repos) {
          const name = repo.name ?? repo.path.split('/').pop() ?? repo.path;
          const rs = scanState.repos[name];
          if (!rs) { neverCount++; continue; }
          if (isStale(rs, stalenessMin)) staleCount++;
          else freshCount++;
        }
        console.log('');
        console.log(
          chalk.dim('  ') +
          chalk.green(`${freshCount} fresh`) + chalk.dim('  ') +
          chalk.yellow(`${staleCount} stale`) + chalk.dim('  ') +
          chalk.dim(`${neverCount} never scanned`) + chalk.dim('  ') +
          chalk.dim(`(${totalRepos} total repos, staleness: ${stalenessMin}m)`),
        );
      }
      break;
    }
    case 'orgs':
      console.log(renderOrgsSection(ctx, termCols));
      break;
    case 'authors': {
      const authResult = renderAuthorsSection(ctx, termCols, selectedAuthorIdx);
      console.log(authResult.output);
      authorEmailGroups = authResult.authorEmailGroups;
      break;
    }
    case 'groups':
      console.log(renderGroupsSection(ctx, termCols));
      break;
    case 'tags':
      console.log(renderTagsSection(ctx, termCols));
      break;
  }

  return { repoNames, authorEmailGroups };
}

// ── Hotkeys ──────────────────────────────────────────────────────────────────

export function buildManageHotkeyItems(
  activeSection: ManageSection,
  hasRepos: boolean,
  hasAuthors: boolean = false,
): Array<{ key: string; label: string }> {
  const items: Array<{ key: string; label: string }> = [];

  // Section toggles (show only non-active sections)
  if (activeSection !== 'repos') items.push({ key: 'R', label: 'Repos' });
  if (activeSection !== 'orgs') items.push({ key: 'O', label: 'Orgs' });
  if (activeSection !== 'authors') items.push({ key: 'A', label: 'Authors' });
  if (activeSection !== 'groups') items.push({ key: 'G', label: 'Groups' });
  if (activeSection !== 'tags') items.push({ key: 'T', label: 'Tags' });

  // Repo actions (always visible in repos section)
  if (activeSection === 'repos') {
    items.push({ key: 'D', label: 'Add repos' });
    if (hasRepos) {
      items.push({ key: '\u2191\u2193', label: 'Select' });
      items.push({ key: 'X', label: 'Remove' });
      items.push({ key: '\u23CE', label: 'Collect' });
      items.push({ key: 'S', label: 'Collect all' });
    }
  }

  // Org actions
  if (activeSection === 'orgs') {
    items.push({ key: 'N', label: 'New org' });
  }

  // Author actions
  if (activeSection === 'authors' && hasAuthors) {
    items.push({ key: '\u2191\u2193', label: 'Select' });
    items.push({ key: '\u23CE', label: 'Assign' });
    items.push({ key: 'P', label: 'Bulk assign prefix' });
  }

  // Export (always available)
  items.push({ key: 'E', label: 'Export' });

  items.push({ key: 'Q', label: 'Quit' });

  return items;
}
