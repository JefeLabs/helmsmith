import { getCachePath } from '../adapters/cache.js';
import { output } from './_shared/output.js';

/** `--json`: one line { path }. Without it, the bare path, for `$(pritty cache path)`. */
export function runCachePath(options: { json?: boolean } = {}): void {
  const { say, result } = output(options.json);
  const path = getCachePath();
  say(path);
  result({ path });
}
