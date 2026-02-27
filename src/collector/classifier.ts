import path from "node:path";

export type FileType = "app" | "test" | "config" | "storybook";

/**
 * Classify a file path into one of four categories.
 * Ordered rule matching: first match wins.
 *
 * Priority 1: storybook
 * Priority 2: test
 * Priority 3: config
 * Priority 4: app (everything else)
 */
export function classifyFile(filePath: string): FileType {
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.basename(normalized);
  const lower = normalized.toLowerCase();
  const baseLower = base.toLowerCase();

  // ── Priority 1: Storybook ──────────────────────────────────────────────────
  // .stories.*, .story.*, .storybook/, .mdx in storybook paths
  if (/\.stories\./.test(baseLower)) return "storybook";
  if (/\.story\./.test(baseLower)) return "storybook";
  if (lower.includes(".storybook/") || lower.includes("/.storybook/")) return "storybook";
  if (baseLower.endsWith(".mdx") && lower.includes("stor")) return "storybook";

  // ── Priority 2: Test ───────────────────────────────────────────────────────
  // .test.*, .spec.*, .cy.*, .e2e.*, __tests__/, /tests?/, vitest.config,
  // jest.config, cypress/, playwright/
  if (/\.test\.\w+$/.test(baseLower)) return "test";
  if (/\.spec\.\w+$/.test(baseLower)) return "test";
  if (/\.cy\.\w+$/.test(baseLower)) return "test";
  if (/\.e2e\.\w+$/.test(baseLower)) return "test";
  if (lower.includes("__tests__/") || lower.includes("/__tests__/")) return "test";
  if (/\/(tests?)\//i.test(lower)) return "test";
  if (/^vitest\.config/i.test(baseLower)) return "test";
  if (/^jest\.config/i.test(baseLower)) return "test";
  if (lower.includes("cypress/")) return "test";
  if (lower.includes("playwright/")) return "test";

  // ── Priority 3: Config ─────────────────────────────────────────────────────
  // .config.*, *.json, *.yml, *.yaml, *.toml, *.env*, Dockerfile,
  // docker-compose, .github/, *.lock, Makefile, .eslintrc, .prettier*,
  // tsconfig*, webpack.config, vite.config
  if (/\.config\.\w+$/.test(baseLower)) return "config";
  if (baseLower.endsWith(".json")) return "config";
  if (baseLower.endsWith(".yml")) return "config";
  if (baseLower.endsWith(".yaml")) return "config";
  if (baseLower.endsWith(".toml")) return "config";
  if (baseLower.includes(".env")) return "config";
  if (/^dockerfile/i.test(baseLower)) return "config";
  if (/^docker-compose/i.test(baseLower)) return "config";
  if (lower.includes(".github/")) return "config";
  if (baseLower.endsWith(".lock")) return "config";
  if (/^makefile$/i.test(baseLower)) return "config";
  if (/^\.eslintrc/i.test(baseLower)) return "config";
  if (/^\.prettier/i.test(baseLower)) return "config";
  if (/^tsconfig/i.test(baseLower)) return "config";
  if (/^webpack\.config/i.test(baseLower)) return "config";
  if (/^vite\.config/i.test(baseLower)) return "config";

  // ── Priority 4: App (everything else) ──────────────────────────────────────
  return "app";
}
