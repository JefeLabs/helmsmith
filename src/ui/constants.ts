import chalk from "chalk";

export const FILETYPE_CHARS = {
  app: "\u2588",
  test: "\u2593",
  config: "\u2591",
  storybook: "\u2592",
  doc: "\u2594",
} as const;

export const FILETYPE_COLORS = {
  app: chalk.green,
  test: chalk.blue,
  config: chalk.yellow,
  storybook: chalk.magenta,
  doc: chalk.cyan,
} as const;

export type FileType = keyof typeof FILETYPE_CHARS;

export const SEGMENT_DEFS = Object.entries(FILETYPE_CHARS).map(
  ([key, char]) => ({
    key,
    label: key,
    char,
    color: FILETYPE_COLORS[key as FileType],
  })
);
