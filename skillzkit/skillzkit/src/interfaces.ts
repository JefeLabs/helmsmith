/**
 * Single source of truth for which invocation interfaces each integration
 * and tool supports.
 *
 * The TUI reads this for display badges. The installer reads this when
 * writing initial entries to the runtime manifests
 * (product/.pencil-integrations.json and product/.pencil-tools.json) so
 * that consumers' commands see the same interface set at execution time
 * that the user saw when picking them.
 *
 * Canonical form is lowercase ("cli", "mcp", "rest"); the TUI uppercases
 * for display.
 *
 * NOTE: hardcoded for v1 because the existing command files don't yet
 * carry an `interfaces` field in their frontmatter. Long-term, this map
 * should move to per-file frontmatter and the catalog generator should
 * extract it. Until then, keep this in sync with each command's reality.
 */

export type Interface = "cli" | "mcp" | "rest";

const INTERFACES: Record<string, Interface[]> = {
  // Integrations
  "core:integrations:jira": ["cli", "mcp", "rest"],
  "core:integrations:github": ["cli", "mcp", "rest"],
  "core:integrations:figma": ["mcp", "rest"],
  "core:integrations:datadog": ["cli", "mcp", "rest"],
  "core:integrations:splunk": ["cli", "rest"],
  "core:integrations:discord": ["rest"],
  "core:integrations:hootsuite": ["rest"],
  "core:integrations:linkedin": ["rest"],
  "core:integrations:outlook": ["rest"],
  "core:integrations:onedrive": ["rest"],
  "core:integrations:teams": ["rest"],
  "core:integrations:instagram": ["rest"],
  "core:integrations:reddit": ["rest"],
  "core:integrations:semrush": ["rest"],
  "core:integrations:x": ["rest"],
  // Tools
  "core:tools:npm": ["cli"],
  "core:tools:maven": ["cli"],
  "core:tools:gradle": ["cli"],
  "core:tools:biome": ["cli"],
  "core:tools:eslint": ["cli"],
  "core:tools:chromatic": ["cli"],
  "core:tools:terraform": ["cli"],
  "core:tools:pixelmatch": ["cli"],
  "core:tools:imagemagick": ["cli"],
  "core:tools:chrome-devtools": ["cli"],
  "core:tools:playwright": ["cli", "mcp"],
  "core:tools:open-pencil": ["cli"],
  "core:tools:pencil-mcp": ["mcp"],
  "core:tools:context7": ["mcp"],
};

export function getInterfaces(slug: string): Interface[] {
  return INTERFACES[slug] ?? [];
}

export function listIntegrations(): Array<{ slug: string; leaf: string; interfaces: Interface[] }> {
  return Object.entries(INTERFACES)
    .filter(([slug]) => slug.startsWith("core:integrations:"))
    .map(([slug, interfaces]) => ({
      slug,
      leaf: slug.slice("core:integrations:".length),
      interfaces,
    }));
}

export function listTools(): Array<{ slug: string; leaf: string; interfaces: Interface[] }> {
  return Object.entries(INTERFACES)
    .filter(([slug]) => slug.startsWith("core:tools:"))
    .map(([slug, interfaces]) => ({
      slug,
      leaf: slug.slice("core:tools:".length),
      interfaces,
    }));
}
