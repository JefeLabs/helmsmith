import chalk from "chalk";
import { categorize, mergeCategories } from "../categorizer.js";
import { loadConfig } from "../config.js";
import { createGit } from "../git.js";

export interface CategorizeOptions {
  all?: boolean;
}

export async function runCategorize(
  options: CategorizeOptions = {},
): Promise<void> {
  const config = loadConfig();
  const git = createGit();
  const files = options.all
    ? await git.getAllChanged()
    : await git.getStaged();

  if (files.length === 0) {
    console.log(
      chalk.dim("No staged files. (Use --all to include modified/untracked.)"),
    );
    return;
  }

  const categories = mergeCategories(config.categories);
  const grouped = categorize(files, categories);
  for (const [name, list] of Object.entries(grouped)) {
    if (list.length === 0) continue;
    console.log(chalk.cyan(`${name}  ${chalk.dim(`(${list.length})`)}`));
    for (const file of list) console.log(`  ${file}`);
  }
}
