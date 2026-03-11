import { loadAuthorRegistrySQL } from '../store/sqlite-store.js';

export interface ListAuthorsOptions {
  unassigned?: boolean;
  assigned?: boolean;
  json?: boolean;
}

export async function listAuthors(options: ListAuthorsOptions = {}): Promise<void> {
  const registry = loadAuthorRegistrySQL();
  let authors = Object.values(registry.authors);

  if (options.unassigned) {
    authors = authors.filter((a) => !a.org);
  } else if (options.assigned) {
    authors = authors.filter((a) => !!a.org);
  }

  if (authors.length === 0) {
    console.log('No authors found. Run "gitradar scan" first.');
    return;
  }

  // Sort: assigned first by org, then unassigned by commit count
  authors.sort((a, b) => {
    if (a.org && !b.org) return -1;
    if (!a.org && b.org) return 1;
    if (a.org && b.org) return a.org.localeCompare(b.org) || b.commitCount - a.commitCount;
    return b.commitCount - a.commitCount;
  });

  if (options.json) {
    console.log(JSON.stringify(authors, null, 2));
    return;
  }

  const assigned = authors.filter((a) => a.org);
  const unassigned = authors.filter((a) => !a.org);

  if (assigned.length > 0) {
    console.log(`\nAssigned (${assigned.length}):`);
    for (const a of assigned) {
      const repos = a.reposSeenIn.length;
      const id = a.identifier ? ` [${a.identifier}]` : '';
      console.log(`  ${a.name}${id}  <${a.email}>  ${a.org} → ${a.team}  (${a.commitCount} commits, ${repos} repos)`);
    }
  }

  if (unassigned.length > 0) {
    console.log(`\nUnassigned (${unassigned.length}):`);
    for (const a of unassigned) {
      const repos = a.reposSeenIn.length;
      const id = a.identifier ? ` [${a.identifier}]` : '';
      console.log(`  ${a.name}${id}  <${a.email}>  (${a.commitCount} commits, ${repos} repos)`);
    }
  }

  console.log(`\nTotal: ${authors.length} authors (${assigned.length} assigned, ${unassigned.length} unassigned)`);
}
