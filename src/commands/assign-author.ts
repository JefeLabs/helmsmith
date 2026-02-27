import { loadAuthorRegistry, saveAuthorRegistry, assignAuthor, assignByIdentifierPrefix } from '../store/author-registry.js';
import { loadCommitsData, saveCommitsData } from '../store/commits-by-filetype.js';
import { loadConfig } from '../config/loader.js';
import { reattributeRecords } from '../collector/author-map.js';

export interface AssignAuthorOptions {
  email: string;
  org: string;
  team: string;
  config?: string;
}

export async function assignAuthorCmd(options: AssignAuthorOptions): Promise<void> {
  const registry = await loadAuthorRegistry();
  const key = options.email.toLowerCase();
  const author = registry.authors[key];

  if (!author) {
    console.error(`Author not found: ${options.email}`);
    console.error('Run "gitradar list-authors" to see available authors.');
    process.exitCode = 1;
    return;
  }

  const updated = assignAuthor(registry, options.email, options.org, options.team);
  await saveAuthorRegistry(updated);

  // Re-attribute existing records
  try {
    const config = await loadConfig(options.config);
    const commitsData = await loadCommitsData();
    const reattributed = reattributeRecords(commitsData.records, config, updated);
    await saveCommitsData({ ...commitsData, records: reattributed });
    console.log(`Assigned ${author.name} <${author.email}> → ${options.org} / ${options.team}`);
    console.log(`Re-attributed ${reattributed.length} records.`);
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
  const registry = await loadAuthorRegistry();
  const result = assignByIdentifierPrefix(registry, options.prefix, options.org, options.team);
  await saveAuthorRegistry(result.registry);

  if (result.assignedCount === 0) {
    console.log(`No unassigned authors found with prefix "${options.prefix}".`);
    return;
  }

  // Re-attribute existing records
  try {
    const config = await loadConfig(options.config);
    const commitsData = await loadCommitsData();
    const reattributed = reattributeRecords(commitsData.records, config, result.registry);
    await saveCommitsData({ ...commitsData, records: reattributed });
    console.log(`Assigned ${result.assignedCount} authors with prefix "${options.prefix}" → ${options.org} / ${options.team}`);
    console.log(`Re-attributed ${reattributed.length} records.`);
  } catch {
    console.log(`Assigned ${result.assignedCount} authors with prefix "${options.prefix}" → ${options.org} / ${options.team}`);
  }
}
