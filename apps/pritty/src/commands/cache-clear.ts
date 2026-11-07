import chalk from 'chalk';
import { clearCache, getCachePath } from '../adapters/cache.js';
import { output } from './_shared/output.js';

/** `--json`: one line { path, removed }; removed is false when there was no cache file. */
export function runCacheClear(options: { json?: boolean } = {}): void {
  const { say, result } = output(options.json);
  const path = getCachePath();
  const removed = clearCache();
  say(removed ? chalk.green(`✓ Cleared ${path}`) : chalk.dim(`Nothing to clear (no ${path})`));
  result({ path, removed });
}
