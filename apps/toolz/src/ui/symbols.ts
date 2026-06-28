/**
 * Single-source styled status symbols. All CLI output that signals
 * success / failure / warning / info routes through here so the color
 * scheme stays consistent and we can swap chalk for a different
 * library (or disable colors entirely under NO_COLOR) in one place.
 */

import chalk from 'chalk';

/**
 * NO_COLOR support — chalk respects this automatically, but exposing
 * the check lets callers branch behavior (e.g. plain ASCII fallbacks
 * when colors are off).
 */
export const colorsEnabled = chalk.level > 0 && !process.env.NO_COLOR;

export const ok = (text: string): string => chalk.green(`✓ ${text}`);
export const fail = (text: string): string => chalk.red(`✗ ${text}`);
export const warn = (text: string): string => chalk.yellow(`⚠ ${text}`);
export const info = (text: string): string => chalk.cyan(`ℹ ${text}`);

export const dim = (text: string): string => chalk.dim(text);
export const bold = (text: string): string => chalk.bold(text);
export const heading = (text: string): string => chalk.bold.cyan(text);
