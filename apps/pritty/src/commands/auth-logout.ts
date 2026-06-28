import chalk from 'chalk';
import { logout as authLogout, getAuthPath } from '../auth.js';

export async function runAuthLogout(): Promise<void> {
  await authLogout();
  console.log(chalk.green(`✓ Logged out (removed ${getAuthPath()})`));
}
