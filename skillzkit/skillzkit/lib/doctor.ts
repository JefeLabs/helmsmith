/**
 * Health check for the kit. Walks the catalog + filesystem, validates
 * cross-references, frontmatter completeness, and structural invariants.
 * Returns a flat list of findings; the CLI groups by severity for
 * display.
 *
 * Intended uses:
 *   - Pre-PR validation (run after `skillzkit-author` scaffolds a new
 *     command/workflow, before submitting upstream).
 *   - Diagnostic when something feels off ("why isn't my new command
 *     showing up in install?").
 *   - CI gate against contribution PRs.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  getCommands,
  getSkills,
  getWorkflows,
  loadCatalog,
} from "./index.js";

export interface Finding {
  severity: "error" | "warning" | "info";
  /** File path or slug the finding is anchored to. */
  source: string;
  message: string;
}

/**
 * Same regex the catalog generator uses to capture `/foo:bar:baz`
 * references. Re-applied here without the known-slugs filter so we can
 * detect references that look like slash commands but resolve to
 * nothing — those are silent contributor mistakes.
 */
const REFERENCE_REGEX = /\/([a-z][a-z0-9_-]*(?::[a-z0-9_*-]+)+)/gi;

export function runDoctor(packageRoot: string): Finding[] {
  const findings: Finding[] = [];
  const catalog = loadCatalog();
  const knownSlugs = new Set<string>([
    ...catalog.commands.map((c) => c.slug),
    ...catalog.skills.map((s) => s.name),
  ]);

  // ─── 1. Broken references ─────────────────────────────────────────
  // Re-scan bodies for /slug patterns that don't resolve to anything
  // in the catalog. The catalog generator filters these out silently,
  // so a typo (`/produc:strategy:scaffold`) becomes invisible — no
  // error, just a missing edge in the graph.
  for (const cmd of catalog.commands) {
    for (const match of cmd.body.matchAll(REFERENCE_REGEX)) {
      const ref = match[1].replace(/[.,;:)\]*]+$/, "");
      if (ref.includes("*")) continue; // wildcards aren't meant to resolve
      if (!knownSlugs.has(ref)) {
        findings.push({
          severity: "warning",
          source: cmd.slug,
          message: `Body cites \`/${ref}\` but no such slug exists in catalog`,
        });
      }
    }
  }
  for (const skill of catalog.skills) {
    for (const match of skill.body.matchAll(REFERENCE_REGEX)) {
      const ref = match[1].replace(/[.,;:)\]*]+$/, "");
      if (ref.includes("*")) continue;
      if (!knownSlugs.has(ref)) {
        findings.push({
          severity: "warning",
          source: skill.name,
          message: `Skill body cites \`/${ref}\` but no such slug exists in catalog`,
        });
      }
    }
  }

  // ─── 2. Orphan files ──────────────────────────────────────────────
  // Every .md under .claude/commands/ should appear in the catalog.
  // A file that exists on disk but isn't indexed means catalog
  // generation skipped it (parse error, missing frontmatter) or it
  // landed in a path the loader doesn't traverse.
  const commandsRoot = join(packageRoot, ".claude", "commands");
  const skillsRoot = join(packageRoot, ".claude", "skills");
  const cmdPathSet = new Set(catalog.commands.map((c) => c.path));
  for (const file of walkMd(commandsRoot)) {
    const rel = relative(commandsRoot, file);
    if (!cmdPathSet.has(rel)) {
      findings.push({
        severity: "error",
        source: rel,
        message: `File exists on disk but not in catalog. Run \`npm run catalog\` to refresh; if it still doesn't appear, check the frontmatter parses cleanly.`,
      });
    }
  }
  // For skills: each subdirectory under .claude/skills/ should have a
  // SKILL.md indexed in the catalog.
  for (const entry of safeReaddir(skillsRoot)) {
    const dir = join(skillsRoot, entry);
    if (!safeIsDir(dir)) continue;
    const skillFile = join(dir, "SKILL.md");
    if (!safeExists(skillFile)) {
      findings.push({
        severity: "error",
        source: entry,
        message: `.claude/skills/${entry}/ has no SKILL.md`,
      });
      continue;
    }
    const indexed = catalog.skills.some(
      (s) => s.path === relative(skillsRoot, skillFile),
    );
    if (!indexed) {
      findings.push({
        severity: "error",
        source: entry,
        message: `Skill SKILL.md exists but isn't in catalog. Check the frontmatter parses cleanly.`,
      });
    }
  }

  // ─── 3. Frontmatter completeness ──────────────────────────────────
  // Empty descriptions surface as blank rows in `list` and the TUI's
  // right pane. Workflows without an `outcome` fall back to slug for
  // the row label, which reads less naturally.
  for (const cmd of catalog.commands) {
    if (cmd.kind === "context") continue;
    if (!cmd.description || cmd.description.trim().length === 0) {
      findings.push({
        severity: "warning",
        source: cmd.slug,
        message: `Empty description frontmatter`,
      });
    }
  }
  for (const skill of catalog.skills) {
    if (!skill.description || skill.description.trim().length === 0) {
      findings.push({
        severity: "warning",
        source: skill.name,
        message: `Empty description frontmatter`,
      });
    }
  }
  for (const wf of catalog.workflows) {
    if (!wf.outcome) {
      findings.push({
        severity: "info",
        source: wf.qualifiedName,
        message: `Workflow has no \`outcome\` frontmatter — TUI will use slug for the row label`,
      });
    }
  }

  // ─── 4. Workflow prerequisites resolve ─────────────────────────────
  // Prerequisites can be free-text preconditions ("brand-config exists")
  // OR slug references (product:greenfield). Only validate the latter —
  // a string with no whitespace that matches the slug regex pattern.
  // Free-text entries (containing spaces, parens, paths, etc.) are
  // informational, not edges in the graph.
  const slugLike = /^[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)+$/;
  for (const wf of catalog.workflows) {
    if (!wf.prerequisites) continue;
    for (const prereq of wf.prerequisites) {
      if (!slugLike.test(prereq)) continue; // free-text, skip
      const resolves =
        catalog.workflows.some((w) => w.qualifiedName === prereq) ||
        catalog.commands.some((c) => c.slug === prereq);
      if (!resolves) {
        findings.push({
          severity: "error",
          source: wf.qualifiedName,
          message: `Prerequisite \`${prereq}\` looks like a slug but doesn't resolve to a known workflow or command`,
        });
      }
    }
  }

  // ─── 5. Self-references ───────────────────────────────────────────
  // Filtered by load.ts during reverse-edge build, but check the
  // forward references[] too so contributors get a clear signal.
  for (const cmd of catalog.commands) {
    if (cmd.references.includes(cmd.slug)) {
      findings.push({
        severity: "info",
        source: cmd.slug,
        message: `Body cites its own slug — usually intentional (a doc referring to itself), but flagged for awareness`,
      });
    }
  }

  return findings;
}

// ─── helpers ──────────────────────────────────────────────────────────

function walkMd(root: string): string[] {
  const out: string[] = [];
  if (!safeExists(root)) return out;
  function recurse(dir: string) {
    for (const entry of safeReaddir(dir)) {
      const full = join(dir, entry);
      if (safeIsDir(full)) recurse(full);
      else if (full.endsWith(".md")) out.push(full);
    }
  }
  recurse(root);
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
