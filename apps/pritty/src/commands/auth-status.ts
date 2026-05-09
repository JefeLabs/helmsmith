import chalk from "chalk";
import { readAuth } from "../auth.js";

export async function runAuthStatus(): Promise<void> {
  const file = await readAuth();
  const providers = Object.entries(file.providers);
  if (providers.length === 0) {
    console.log(chalk.dim("Not logged in. Run `pritty auth login`."));
    return;
  }
  console.log(chalk.cyan(`Authenticated providers (${providers.length})`));
  for (const [id, entry] of providers) {
    console.log(`  ${chalk.bold(id)}`);
    console.log(chalk.dim(`    scope:    ${entry.scope ?? "(default)"}`));
    console.log(chalk.dim(`    created:  ${entry.createdAt ?? "?"}`));
    if (entry.expiresAt) console.log(chalk.dim(`    expires:  ${entry.expiresAt}`));
  }
}
