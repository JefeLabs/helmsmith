import { assignAuthor, assignByIdentifierPrefix } from '../store/author-registry.js';
import { loadAuthorRegistrySQL, saveAuthorRegistrySQL, queryRecords, reattributeRecordsSQL } from '../store/sqlite-store.js';
import { loadConfig } from '../config/loader.js';
import { buildAuthorMap, buildIdentifierRules } from '../collector/author-map.js';

export interface AssignAuthorOptions {
  email: string;
  org: string;
  team: string;
  config?: string;
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

  // Re-attribute existing records via SQL UPDATE
  try {
    const config = await loadConfig(options.config);
    const authorMap = buildAuthorMap(config, updated);
    const identifierRules = buildIdentifierRules(config);
    const updates: Array<{ email: string; org: string; orgType: string; team: string; tag: string }> = [];
    updates.push({ email: key, org: options.org, orgType: 'core', team: options.team, tag: 'default' });
    reattributeRecordsSQL(updates);
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

  // Re-attribute existing records via SQL UPDATE for all newly assigned authors
  try {
    const updates: Array<{ email: string; org: string; orgType: string; team: string; tag: string }> = [];
    for (const [email, author] of Object.entries(result.registry.authors)) {
      if (author.org === options.org && author.team === options.team) {
        updates.push({ email, org: options.org, orgType: 'core', team: options.team, tag: 'default' });
      }
    }
    if (updates.length > 0) reattributeRecordsSQL(updates);
    console.log(`Assigned ${result.assignedCount} authors with prefix "${options.prefix}" → ${options.org} / ${options.team}`);
    console.log(`Re-attributed records for ${updates.length} authors.`);
  } catch {
    console.log(`Assigned ${result.assignedCount} authors with prefix "${options.prefix}" → ${options.org} / ${options.team}`);
  }
}
