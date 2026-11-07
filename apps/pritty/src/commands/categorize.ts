import chalk from 'chalk';
import { categorize, mergeCategories } from '../categorizer.js';
import { loadConfig } from '../config.js';
import { createGit } from '../git.js';
import { output } from './_shared/output.js';

export interface CategorizeOptions {
  all?: boolean;
  /** One JSON line { all, categories: [{ category, files }] }; empty categories are left out. */
  json?: boolean;
}

export async function runCategorize(options: CategorizeOptions = {}): Promise<void> {
  const { say, result } = output(options.json);
  const config = loadConfig();
  const git = createGit();
  const files = options.all ? await git.getAllChanged() : await git.getStaged();

  const grouped = files.length > 0 ? categorize(files, mergeCategories(config.categories)) : {};
  const categories = Object.entries(grouped)
    .filter(([, list]) => list.length > 0)
    .map(([category, list]) => ({ category, files: list }));

  if (files.length === 0) {
    say(chalk.dim('No staged files. (Use --all to include modified/untracked.)'));
  }
  for (const { category, files: list } of categories) {
    say(chalk.cyan(`${category}  ${chalk.dim(`(${list.length})`)}`));
    for (const file of list) say(`  ${file}`);
  }
  result({ all: Boolean(options.all), categories });
}
