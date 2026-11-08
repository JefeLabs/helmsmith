/**
 * `<ConnectView>` behaviour, rendered for real. openTUI needs Bun, so each
 * case runs `__fixtures__/connect-render.ts` under the vendored Bun and reads
 * back what the user would be looking at.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureValues, runBunFixture } from '../test-support/runBunFixture.ts';

const FIXTURE = join(import.meta.dirname, '__fixtures__', 'connect-render.ts');

function render(scenario: 'idle' | 'login-fails') {
  const run = runBunFixture(FIXTURE, [scenario]);
  const frame = /FRAME-BEGIN\n([\s\S]*)\nFRAME-END/.exec(run.stdout)?.[1];
  if (run.status !== 0 || frame === undefined) {
    throw new Error(`fixture failed (exit ${run.status}):\n${run.stderr}\n${run.stdout}`);
  }
  return { frame, statusCalls: Number(fixtureValues(run).STATUS_CALLS) };
}

describe('ConnectView', () => {
  it('fetches status once on mount, not again on every re-render', () => {
    const { statusCalls } = render('idle');

    expect(statusCalls).toBe(1);
  }, 20_000);

  it('keeps a failed login’s error on screen after the status refresh', () => {
    const { frame } = render('login-fails');

    expect(frame).toContain('login failed: device code expired');
  }, 20_000);
});
