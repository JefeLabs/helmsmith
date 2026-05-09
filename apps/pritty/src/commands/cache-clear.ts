import chalk from "chalk";
import { clearCache, getCachePath } from "../adapters/cache.js";

export function runCacheClear(): void {
  clearCache();
  console.log(chalk.green(`✓ Cleared ${getCachePath()}`));
}
