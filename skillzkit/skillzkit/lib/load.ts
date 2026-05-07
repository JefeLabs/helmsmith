import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import matter from "gray-matter";
import type { Command, Frontmatter, Skill, Workflow } from "./types.js";

interface ParsedFile {
  absolutePath: string;
  relativePath: string;
  frontmatter: Frontmatter;
  body: string;
}

export function walkMarkdown(root: string): ParsedFile[] {
  const out: ParsedFile[] = [];
  function recurse(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        recurse(full);
      } else if (stat.isFile() && entry.endsWith(".md")) {
        const raw = readFileSync(full, "utf8");
        const parsed = parseFrontmatter(raw, full);
        out.push({
          absolutePath: full,
          relativePath: relative(root, full),
          frontmatter: parsed.frontmatter,
          body: parsed.body,
        });
      }
    }
  }
  recurse(root);
  return out;
}

/**
 * Parse YAML frontmatter with a fallback for files whose values aren't
 * strict YAML (e.g. `argument-hint: [--flag]` where `[` is unquoted).
 * Tries gray-matter first; on failure, hand-extracts simple `key: value`
 * pairs from the frontmatter block.
 */
function parseFrontmatter(raw: string, filePath: string): { frontmatter: Frontmatter; body: string } {
  try {
    const parsed = matter(raw);
    return {
      frontmatter: parsed.data as Frontmatter,
      body: parsed.content.trimStart(),
    };
  } catch {
    // Fallback: split on the second `---` and extract simple key: value lines.
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      console.warn(`  ! No frontmatter in ${filePath}; treating whole file as body`);
      return { frontmatter: {}, body: raw.trimStart() };
    }
    const [, fmBlock, body] = match;
    const fm: Frontmatter = {};
    for (const line of fmBlock.split("\n")) {
      const kv = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
      if (kv) {
        const [, key, value] = kv;
        // Strip quotes if present
        fm[key] = value.replace(/^["'](.*)["']$/, "$1");
      }
    }
    console.warn(`  ! Lenient parse for ${filePath} (frontmatter not strict YAML)`);
    return { frontmatter: fm, body: body.trimStart() };
  }
}

function pathToSlashCommand(relativePath: string): string {
  // "core/tools/npm.md" → "core:tools:npm"
  return relativePath.replace(/\.md$/, "").split(sep).join(":");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value;
  }
  if (typeof value === "string") {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Match `/foo:bar:baz` slash-command references in body text. Captures
 * just the identifier (`foo:bar:baz`), not the leading slash.
 */
const REFERENCE_REGEX = /\/([a-z][a-z0-9_-]*(?::[a-z0-9_*-]+)+)/gi;

function extractReferences(body: string, knownSlugs: Set<string>): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(REFERENCE_REGEX)) {
    let ref = match[1].replace(/[.,;:)\]*]+$/, "");
    if (ref.includes("*")) continue; // wildcard refs like `core:tools:*` aren't real items
    if (!knownSlugs.has(ref)) continue; // filter to real catalog items only
    seen.add(ref);
  }
  return Array.from(seen).sort();
}

export function loadCommands(commandsRoot: string): Command[] {
  const files = walkMarkdown(commandsRoot);
  // First pass: build the slug index so reference extraction can filter
  // matches to only real catalog commands.
  const knownSlugs = new Set(files.map((f) => pathToSlashCommand(f.relativePath)));
  const commands: Command[] = files.map((file) => {
    const slug = pathToSlashCommand(file.relativePath);
    const fm = file.frontmatter;
    const segments = file.relativePath.split(sep);
    const isContext = segments.some((segment) => segment.startsWith("_"));
    // A file is a workflow if its frontmatter says so OR it lives under a
    // persona's workflows/ directory. The path-based check catches files
    // that pre-date the `type: workflow` convention.
    const isInPersonaWorkflowsDir = segments[0] !== "core" && segments.includes("workflows");
    const isWorkflow = fm.type === "workflow" || isInPersonaWorkflowsDir;
    // Context wins over workflow: _context.md files inside workflows/
    // directories are documentation, not workflow playbooks.
    const kind = isContext ? "context" : isWorkflow ? "workflow" : "command";

    return {
      slug,
      path: file.relativePath,
      kind,
      outcome: asString(fm.outcome),
      description: asString(fm.description) ?? "",
      argumentHint: asString(fm["argument-hint"]),
      allowedTools: asStringArray(fm["allowed-tools"]),
      references: extractReferences(file.body, knownSlugs),
      // Filled in by the second pass below — start empty so the field is
      // always present on the returned object (TS narrowing wins).
      referencedBy: [],
      body: file.body,
      frontmatter: fm,
    };
  });

  // Second pass: invert the references graph. For every command X and
  // every slug Y in X.references, append X.slug to Y.referencedBy.
  // O(n*r) where n = commands and r = avg references per command —
  // both small in practice.
  const bySlug = new Map(commands.map((c) => [c.slug, c]));
  for (const cmd of commands) {
    for (const ref of cmd.references) {
      if (ref === cmd.slug) continue; // skip self-loops (a doc citing its own slug)
      const target = bySlug.get(ref);
      if (target && !target.referencedBy.includes(cmd.slug)) {
        target.referencedBy.push(cmd.slug);
      }
    }
  }
  for (const cmd of commands) cmd.referencedBy.sort();
  return commands;
}

export function loadSkills(skillsRoot: string, commands: Command[]): Skill[] {
  const knownSlugs = new Set(commands.map((c) => c.slug));
  const out: Skill[] = [];
  for (const entry of readdirSync(skillsRoot)) {
    const dir = join(skillsRoot, entry);
    if (!statSync(dir).isDirectory()) continue;
    const skillFile = join(dir, "SKILL.md");
    try {
      const raw = readFileSync(skillFile, "utf8");
      const parsed = parseFrontmatter(raw, skillFile);
      const fm = parsed.frontmatter;
      const name = asString(fm.name) ?? entry;
      out.push({
        name,
        path: relative(skillsRoot, skillFile),
        description: asString(fm.description) ?? "",
        references: extractReferences(parsed.body, knownSlugs),
        body: parsed.body,
        frontmatter: fm,
      });
    } catch {
      // Skip directories without SKILL.md
    }
  }
  return out;
}

export function deriveWorkflows(commands: Command[]): Workflow[] {
  return commands
    .filter((cmd) => cmd.kind === "workflow")
    .map((cmd) => {
      // path looks like "product/strategy/workflows/greenfield.md" or
      // "engineer/architecture/workflows/adr-cycle.md" or
      // "market/workflows/launch-campaign.md"
      const segments = cmd.path.replace(/\.md$/, "").split(sep);
      const slug = segments[segments.length - 1];
      // Domain is the first segment (product, engineer, market)
      const domain = segments[0];
      const qualifiedName = `${domain}:${slug}`;
      const fm = cmd.frontmatter;

      return {
        qualifiedName,
        domain,
        slug,
        commandSlug: cmd.slug,
        outcome: asString(fm.outcome),
        description: cmd.description,
        estimatedDuration: asString(fm.estimatedDuration),
        phases: asNumber(fm.phases),
        prerequisites: asStringArray(fm.prerequisites),
        references: cmd.references,
        body: cmd.body,
        frontmatter: fm,
      };
    });
}
