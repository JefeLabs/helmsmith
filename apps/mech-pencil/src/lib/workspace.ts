/**
 * Filesystem helpers for the generated Pencil document.
 *
 * `mech-pencil init` produces ONE self-contained file:
 *
 *   <dir>/<name>.pen     tokens + reusable components + mockup screens
 *
 * Single-file is mandatory: cross-file `imports`/refs resolve in Pencil
 * but cannot be customized via `descendants`, so a design system whose
 * mockups override component internals must keep everything local.
 *
 * The on-disk `.pen` is plain JSON the CLI writes and re-reads itself.
 * (The Pencil *editor* MCP treats live editor files as opaque — a
 * separate concern from this documented file format.)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_DOC_NAME = 'design';

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeText(file: string, content: string): void {
  ensureDir(dirname(file));
  writeFileSync(file, content, 'utf8');
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Absolute path of the single generated document. */
export function documentPath(dir: string, name = DEFAULT_DOC_NAME): string {
  return join(dir, `${name}.pen`);
}
