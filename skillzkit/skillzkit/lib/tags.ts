/**
 * Shared utilities for the tag system. Tags are orthogonal discovery
 * metadata (see TAGS.md) — used by `skillzkit search`,
 * `skillzkit list --tag`, `skillzkit tags`, and the doctor's two-tier
 * format/membership check. Tags do NOT affect router membership or
 * install cascade — those remain strictly path-based.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog } from "./types.js";

/**
 * Parse the `## Core tags` section of TAGS.md and return the set of
 * core tag names. Each core tag appears as a `### \`<tag>\`` heading
 * within that section. Returns an empty set when TAGS.md is missing or
 * the section can't be located — callers decide how to fall back
 * (doctor warns; the `tags` subcommand treats everything as
 * extension).
 */
export function loadCoreTags(packageRoot: string): Set<string> {
  const tagsPath = join(packageRoot, "TAGS.md");
  if (!existsSync(tagsPath)) return new Set();
  let raw: string;
  try {
    raw = readFileSync(tagsPath, "utf8");
  } catch {
    return new Set();
  }
  const sectionMatch = raw.match(/##\s+Core tags\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!sectionMatch) return new Set();
  const tags = new Set<string>();
  for (const m of sectionMatch[1].matchAll(/^###\s+`([a-z][a-z0-9-]*)`/gm)) {
    tags.add(m[1]);
  }
  return tags;
}

/**
 * Build a tag → count map from the catalog. Counts every artifact
 * that carries the tag exactly once.
 *
 * Important: skips kind="context" commands (documentation, not
 * artifacts users discover by tag) and does NOT iterate
 * catalog.workflows separately — workflow records are derived from
 * workflow-kind commands which ARE iterated, so iterating both would
 * double-count.
 */
export function collectTagCounts(catalog: Catalog): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (tag: string) => counts.set(tag, (counts.get(tag) ?? 0) + 1);
  for (const cmd of catalog.commands) {
    if (cmd.kind === "context") continue;
    for (const tag of cmd.tags ?? []) bump(tag);
  }
  for (const skill of catalog.skills) {
    for (const tag of skill.tags ?? []) bump(tag);
  }
  return counts;
}
