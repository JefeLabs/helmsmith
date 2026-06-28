# toolz e2e tests

End-to-end tests that spawn the built `toolz` CLI as a subprocess.

## Convention

See [`apps/pritty/tests/e2e/README.md`](../../../pritty/tests/e2e/README.md)
for the full convention — same pattern across the toolbox.

In short:

- Run via `npm run test:e2e`
- Build the CLI first (typically via a vitest `globalSetup`)
- Spawn `dist/cli.js` with `execFile`
- Isolate state with temp dirs

## What goes here vs co-located

- `src/**/*.test.ts` — unit tests for individual modules (platform
  detection, registry parsing, etc.)
- `tests/e2e/` — full-CLI invocations that verify
  `toolz check <tool>`, `toolz install <tool>`, etc. work end-to-end
  against a real filesystem and (where unavoidable) real package
  managers in a sandboxed environment.

Note: toolz's `tests/unit/` directory pre-dates the convention.
Co-located `src/**/*.test.ts` is the new home for unit tests; existing
`tests/unit/` files stay where they are until a future refactor
moves them.
