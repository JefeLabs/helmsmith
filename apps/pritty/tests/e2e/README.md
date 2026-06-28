# pritty e2e tests

End-to-end tests that spawn the built `pritty` CLI as a subprocess.
Verify the full request → response flow including:

- Bin stub launches via Bun and resolves `dist/cli.js`
- Commander parses real arguments correctly
- Auth wiring through `prittyAuthProvider` works against a temp auth file
- Subcommands (`init`, `commit`, `pr`, etc.) produce the expected
  filesystem effects and exit codes

## Convention

Run via `npm run test:e2e`. Tests must:

1. Build the CLI first (`tsup`) — typically wired in a vitest
   `globalSetup` hook (see `apps/taskmaster/tests/e2e/global-setup.ts`
   for the canonical example).
2. Use `execFile` from `node:child_process` to spawn `dist/cli.js`.
   Test assertions check stdout/stderr/exitCode.
3. Isolate state — each test gets a fresh temp directory (typically
   via `mkdtemp(tmpdir() + '/pritty-e2e-')`) and sets
   `PRITTY_HOME=<temp-dir>` in the spawned env.
4. Clean up after themselves in `afterEach`.

## Why segregated from co-located unit tests

Co-located `src/**/*.test.ts` tests run in milliseconds and exercise
single units. E2E tests spawn subprocesses, hit the filesystem, and
take seconds. Segregating them by directory:

- Lets `npm run test` stay fast (unit only)
- Lets CI run e2e in parallel job(s) without slowing the inner loop
- Makes the cost-vs-coverage trade-off explicit at file location

## Adding a test

```ts
// pritty.help.test.ts
import { describe, it, expect } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFile = promisify(execFileCb);
const CLI = resolve(import.meta.dirname, '../../dist/cli.js');

describe('pritty --help', () => {
  it('prints usage', async () => {
    const { stdout, stderr } = await execFile('node', [CLI, '--help']);
    expect(stdout).toContain('pritty');
    expect(stderr).toBe('');
  });
});
```
