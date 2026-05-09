import { loadCatalog } from "../index.js";

/** Print the package version (read from the generated catalog). */
export function runVersion(): void {
  const catalog = loadCatalog();
  console.log(catalog.packageVersion);
}
