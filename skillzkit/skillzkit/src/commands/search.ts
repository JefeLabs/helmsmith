import {
  getCommands,
  getSkills,
  getWorkflows,
} from "../index.js";
import { truncate } from "./_shared/format.js";

export interface SearchOptions {
  limit?: string;
}

/**
 * Substring search across slug/qualifiedName/name, description, and
 * tags. Tags are a first-class search axis — searching `accessibility`
 * surfaces hits across all personas.
 */
export function runSearch(query: string, options: SearchOptions = {}): void {
  const limit = options.limit ? Number.parseInt(options.limit, 10) : 10;
  const q = query.toLowerCase();
  const matches = (haystack: string) => haystack.toLowerCase().includes(q);
  const matchesAnyTag = (tags: string[] | undefined) =>
    (tags ?? []).some(matches);

  const cmds = getCommands().filter(
    (c) =>
      c.kind === "command" &&
      (matches(c.slug) || matches(c.description) || matchesAnyTag(c.tags)),
  );
  const wfs = getWorkflows().filter(
    (w) =>
      matches(w.qualifiedName) ||
      matches(w.description) ||
      matchesAnyTag(w.tags),
  );
  const skls = getSkills().filter(
    (s) =>
      matches(s.name) || matches(s.description) || matchesAnyTag(s.tags),
  );

  if (cmds.length + wfs.length + skls.length === 0) {
    console.log(`No matches for "${query}".`);
    return;
  }

  if (cmds.length > 0) {
    console.log(
      `\nCommands (${cmds.length}${cmds.length > limit ? `, showing ${limit}` : ""})`,
    );
    for (const c of cmds.slice(0, limit)) {
      console.log(`  /${c.slug}  —  ${truncate(c.description, 80)}`);
    }
  }
  if (wfs.length > 0) {
    console.log(
      `\nWorkflows (${wfs.length}${wfs.length > limit ? `, showing ${limit}` : ""})`,
    );
    for (const w of wfs.slice(0, limit)) {
      console.log(
        `  ${w.qualifiedName}  —  ${truncate(w.description, 80)}`,
      );
    }
  }
  if (skls.length > 0) {
    console.log(
      `\nSkills (${skls.length}${skls.length > limit ? `, showing ${limit}` : ""})`,
    );
    for (const s of skls.slice(0, limit)) {
      console.log(`  ${s.name}  —  ${truncate(s.description, 80)}`);
    }
  }
}
