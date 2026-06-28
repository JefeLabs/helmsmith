/**
 * `mech-pencil gen` — alias of `init`.
 *
 * Single-file is the only correct output shape (cross-file refs can't
 * be customized via `descendants`), so there is no separate
 * "library vs mockup" emit anymore — one document holds tokens,
 * reusable components, and mockup screens.
 */

import { type GenerateOptions, runGenerate } from './init.ts';

export function runGen(options: GenerateOptions): void {
  runGenerate(options);
}
