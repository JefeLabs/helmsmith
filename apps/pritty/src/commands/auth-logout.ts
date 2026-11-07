import chalk from 'chalk';
import { logout as authLogout, getAuthPath } from '../auth.js';
import { output } from './_shared/output.js';

/** `--json`: one line { path, removed }; removed is false when there was no auth file. */
export async function runAuthLogout(options: { json?: boolean } = {}): Promise<void> {
  const { say, result } = output(options.json);
  const path = getAuthPath();
  const removed = await authLogout();
  say(
    removed
      ? chalk.green(`✓ Logged out (removed ${path})`)
      : chalk.dim(`Already logged out (no ${path})`),
  );
  result({ path, removed });
}
