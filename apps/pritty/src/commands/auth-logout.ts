import chalk from "chalk";
import { getAuthPath, logout as authLogout } from "../auth.js";

export async function runAuthLogout(): Promise<void> {
  await authLogout();
  console.log(chalk.green(`✓ Logged out (removed ${getAuthPath()})`));
}
