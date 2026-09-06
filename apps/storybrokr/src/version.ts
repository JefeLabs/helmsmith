import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// tsup inlines JSON imports; resolving at runtime keeps the version honest
// for `tsx src/cli.ts` too.
export const VERSION: string = (require('../package.json') as { version: string }).version;
