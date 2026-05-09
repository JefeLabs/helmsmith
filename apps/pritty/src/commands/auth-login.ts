import chalk from "chalk";
import { getAuthPath, login as authLogin } from "../auth.js";

export async function runAuthLogin(): Promise<void> {
  try {
    const result = await authLogin({
      onPrompt: ({ verificationUri, userCode }) => {
        console.log("");
        console.log(chalk.cyan("Open this URL in a browser:"));
        console.log(`  ${chalk.bold(verificationUri)}`);
        console.log("");
        console.log(chalk.cyan("Enter this code:"));
        console.log(`  ${chalk.bold.yellow(userCode)}`);
        console.log("");
        console.log(chalk.dim("Waiting for authorization..."));
      },
    });
    console.log(chalk.green(`✓ Logged in (provider: ${result.provider})`));
    console.log(chalk.dim(`  scope:  ${result.scope ?? "(default)"}`));
    console.log(chalk.dim(`  stored: ${getAuthPath()}`));
  } catch (err) {
    console.error(chalk.red(`✗ Login failed: ${(err as Error).message}`));
    process.exit(1);
  }
}
