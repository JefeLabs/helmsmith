/**
 * Note-to-note links for prose source types (prose-markdown, oss-docs).
 *
 * Two halves with different scopes:
 *   - extractLinks() is per-file: what counts as a link in this markdown.
 *     The heading-based chunker calls it and reports the refs unresolved.
 *   - createLinkResolver() is corpus-wide: which ingested doc a ref points
 *     at. ingest() builds it after the walk, once every doc path is known,
 *     because `[[Note]]` is a vault-wide lookup (Obsidian semantics).
 */

import { posix } from 'node:path';

/** A link as written in a note, before it's resolved to a doc id. */
export interface LinkRef {
  /** `wiki` = Obsidian `[[target]]` / `![[target]]`; `markdown` = `[text](target)`. */
  kind: 'wiki' | 'markdown';
  /** Wikilink linkpath (alias and #subpath dropped) or decoded href
   *  (#anchor and ?query dropped). */
  target: string;
}

const FENCED_CODE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;
const MARKDOWN_LINK = /\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)/g;
/** `https:`, `mailto:`, `obsidian:`, … and protocol-relative `//host`. */
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/** Links to other notes, in wikilink-then-markdown order. Links inside code
 *  (fenced or inline) are ignored — `fn[0](x)` in a snippet isn't a link. */
export function extractLinks(md: string): LinkRef[] {
  const prose = md.replace(FENCED_CODE, '').replace(INLINE_CODE, '');
  const links: LinkRef[] = [];

  for (const [, inner] of prose.matchAll(WIKILINK)) {
    // `[[target#subpath|alias]]`; inside tables the pipe is escaped as `\|`.
    const target = inner!.split('|')[0]!.replace(/\\$/, '').split('#')[0]!.trim();
    // An empty target is `[[#Heading]]` — a jump within the same note.
    if (target) links.push({ kind: 'wiki', target });
  }

  for (const [, raw] of prose.matchAll(MARKDOWN_LINK)) {
    const href = raw!.startsWith('<') ? raw!.slice(1, -1) : raw!;
    if (EXTERNAL.test(href)) continue;
    const target = safeDecode(href.split(/[#?]/)[0]!);
    if (target) links.push({ kind: 'markdown', target });
  }

  return links;
}

export interface LinkResolver {
  /** Root-relative path of the doc `ref` points at, or null if none matches. */
  resolve(fromPath: string, ref: LinkRef): string | null;
}

/**
 * Obsidian-style resolution over a fixed set of root-relative doc paths:
 *   1. `./` and `../` targets — and any markdown href, per CommonMark —
 *      resolve relative to the linking note first. `./` / `../` stop here.
 *   2. Exact vault-absolute path: `[[projects/alpha]]`, `[x](/Note.md)`.
 *   3. Whole-segment path suffix — the "shortest path when possible" form
 *      Obsidian writes: `[[alpha]]`, `[[health/Log]]`. One match wins;
 *      several are settled by chooseAmongMatches() (same folder, then
 *      closest to the root).
 * Matching ignores case, Unicode normalization form, and a missing extension.
 */
export function createLinkResolver(paths: Iterable<string>): LinkResolver {
  const sorted = [...paths].sort();
  // Full path and extensionless path → doc path. Full paths go in first so
  // `README` (no extension) beats `README.md`'s stem.
  const byPath = new Map<string, string>();
  // Last segment, with and without extension → doc paths sharing it.
  const byName = new Map<string, string[]>();
  for (const p of sorted) byPath.set(key(p), p);
  for (const p of sorted) {
    const stem = key(stripExt(p));
    if (!byPath.has(stem)) byPath.set(stem, p);
    for (const name of new Set([lastSegment(key(p)), lastSegment(stem)])) {
      byName.set(name, [...(byName.get(name) ?? []), p]);
    }
  }

  const lookup = (path: string): string | null => byPath.get(key(path)) ?? null;

  return {
    resolve(fromPath, { kind, target }) {
      const explicitlyRelative = /^\.\.?\//.test(target);
      if (explicitlyRelative || (kind === 'markdown' && !target.startsWith('/'))) {
        const joined = posix.join(posix.dirname(fromPath), target);
        const escapesRoot = joined === '..' || joined.startsWith('../');
        const hit = escapesRoot ? null : lookup(joined);
        if (hit || explicitlyRelative) return hit;
      }

      const absolute = target.replace(/^\/+/, '');
      const exact = lookup(absolute);
      if (exact) return exact;

      const t = key(absolute);
      const matches = (byName.get(lastSegment(t)) ?? []).filter((p) =>
        [key(p), key(stripExt(p))].some((form) => form === t || form.endsWith(`/${t}`)),
      );
      if (matches.length <= 1) return matches[0] ?? null;
      return chooseAmongMatches(fromPath, matches);
    },
  };
}

/**
 * Pick the target when a link's path suffix matches several notes and none
 * sits at the exact vault path — e.g. `[[Log]]` with both `projects/Log.md`
 * and `areas/health/Log.md`, and no root-level `Log.md`.
 *
 * A namesake in the linking note's own folder wins (Obsidian's behavior);
 * otherwise the one fewest folders deep. Candidates arrive sorted, so the
 * alphabetically-first path wins a tie — the same vault always resolves
 * the same way.
 */
function chooseAmongMatches(fromPath: string, candidates: string[]): string {
  const folder = posix.dirname(fromPath);
  const sameFolder = candidates.filter((p) => posix.dirname(p) === folder);
  const pool = sameFolder.length > 0 ? sameFolder : candidates;
  return pool.reduce((best, p) => (depth(p) < depth(best) ? p : best));
}

const depth = (p: string): number => p.split('/').length;
const key = (s: string): string => s.normalize('NFC').toLowerCase();
const stripExt = (p: string): string => p.replace(/\.[^./]+$/, '');
const lastSegment = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // a literal `%` that isn't an escape, e.g. `100%.md`
  }
}
