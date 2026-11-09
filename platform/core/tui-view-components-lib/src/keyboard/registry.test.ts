/**
 * The keybinding registry, mounted for real under Bun (see
 * `__fixtures__/keybinding-render.ts`).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureValues, runBunFixture } from '../test-support/runBunFixture.ts';

const FIXTURE = join(import.meta.dirname, '__fixtures__', 'keybinding-render.ts');

describe.each(['string', 'function'] as const)('useKeybinding with a %s matcher', (matcher) => {
  it('registers once instead of re-registering on every render', () => {
    const run = runBunFixture(FIXTURE, [matcher]);
    const values = fixtureValues(run);

    expect(values.RENDER_LOOP, run.stderr).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    // Mount, plus the one re-render from the registration landing in the provider.
    expect(Number(values.RENDERS)).toBeLessThanOrEqual(3);
  }, 20_000);

  it('still dispatches the bound key to its handler', () => {
    const values = fixtureValues(runBunFixture(FIXTURE, [matcher]));

    expect(values.HANDLED).toBe('1');
  }, 20_000);
});
