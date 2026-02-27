import chalk from "chalk";
import { stripAnsi, padRight } from "./format.js";

export interface BannerOptions {
  /** Main title, rendered with chalk.bold */
  title: string;
  /** Subtitle shown below the title */
  subtitle?: string;
  /** Right-aligned text (e.g., week range) */
  right?: string;
  /** Right-aligned secondary text below right */
  rightSub?: string;
}

/**
 * Render a header/title banner block.
 *
 * The title is rendered bold. If right-aligned text is provided, it is
 * placed at the far right of the terminal width. Uses process.stdout.columns
 * for width, defaulting to 80 if unavailable.
 */
export function renderBanner(options: BannerOptions): string {
  const width = process.stdout.columns || 80;
  const lines: string[] = [];

  // Line 1: title + optional right text
  const titleStr = chalk.bold(options.title);
  if (options.right) {
    const titleVisible = stripAnsi(titleStr).length;
    const rightVisible = stripAnsi(options.right).length;
    const gap = Math.max(2, width - titleVisible - rightVisible);
    lines.push(titleStr + " ".repeat(gap) + options.right);
  } else {
    lines.push(titleStr);
  }

  // Line 2: subtitle + optional rightSub
  if (options.subtitle || options.rightSub) {
    const subtitleStr = options.subtitle ?? "";
    if (options.rightSub) {
      const subVisible = stripAnsi(subtitleStr).length;
      const rightSubVisible = stripAnsi(options.rightSub).length;
      const gap = Math.max(2, width - subVisible - rightSubVisible);
      lines.push(subtitleStr + " ".repeat(gap) + options.rightSub);
    } else {
      lines.push(subtitleStr);
    }
  }

  // Separator line
  lines.push(chalk.dim("\u2500".repeat(Math.min(width, 120))));

  return lines.join("\n");
}
