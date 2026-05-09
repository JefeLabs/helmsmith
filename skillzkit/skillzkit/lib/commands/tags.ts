import { loadCatalog } from "../index.js";
import { collectTagCounts, loadCoreTags } from "../tags.js";
import { findPackageRoot } from "./_shared/package-root.js";

/**
 * List every tag in the catalog with usage counts, split into core
 * (TAGS.md whitelist) and extension (free-form, candidates for
 * promotion). Mirrors the doctor's two-tier tag check at a higher
 * level — tags here is the discovery + governance surface; doctor
 * is the gating CI check.
 */
export function runTags(): void {
  const packageRoot = findPackageRoot();
  const catalog = loadCatalog();
  const core = loadCoreTags(packageRoot);
  const counts = collectTagCounts(catalog);

  if (counts.size === 0) {
    console.log(
      "No tags found in the catalog. Add `tags: [...]` to artifact frontmatter; see TAGS.md for the curated core list.",
    );
    return;
  }

  // Split tags into core (in TAGS.md) and extension (everything else),
  // sorted by descending usage count then alphabetically. Showing
  // counts inline gives you a quick read on which extensions are
  // accumulating enough usage to deserve promotion.
  const used = new Set(counts.keys());
  const allTags = Array.from(new Set([...core, ...used])).sort();
  const coreUsed = allTags.filter((t) => core.has(t));
  const extensions = allTags.filter((t) => !core.has(t));
  const byCount = (a: string, b: string) =>
    (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);

  console.log(`\n=== Core tags (${coreUsed.length}) ===`);
  if (coreUsed.length === 0) {
    console.log("  (TAGS.md present but no core tags found in the catalog)");
  }
  for (const tag of coreUsed.sort(byCount)) {
    const n = counts.get(tag) ?? 0;
    const marker = n === 0 ? " (unused)" : "";
    console.log(
      `  ${tag.padEnd(20)} ${n} use${n === 1 ? "" : "s"}${marker}`,
    );
  }

  console.log(`\n=== Extension tags (${extensions.length}) ===`);
  if (extensions.length === 0) {
    console.log("  (no extension tags in use)");
  }
  for (const tag of extensions.sort(byCount)) {
    const n = counts.get(tag) ?? 0;
    console.log(`  ${tag.padEnd(20)} ${n} use${n === 1 ? "" : "s"}`);
  }

  if (extensions.length > 0) {
    console.log(
      "\nExtension tags with broad usage (≥5 artifacts, ≥2 personas) are candidates for promotion into TAGS.md core. See TAGS.md for the criteria.",
    );
  }
}
