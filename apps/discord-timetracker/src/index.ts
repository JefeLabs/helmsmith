/**
 * @jefelabs/discord-timetracker — library surface.
 *
 * Most consumers use the CLI (`src/cli.ts` / the `discord-timetracker`
 * bin). This module re-exports the pieces worth importing
 * programmatically as the codebase grows (storage adapters, the
 * report service, domain types). For M0 it intentionally exports only
 * the package metadata so `import`/`build` have a stable entry.
 */

export const name = '@jefelabs/discord-timetracker';
export const version = '0.1.0';
