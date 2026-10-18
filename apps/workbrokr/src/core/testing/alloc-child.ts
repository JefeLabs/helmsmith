// Child process for the multi-process allocation test: allocate N slots on one registry, print them.

import { validateManifest } from '../manifest.js';
import { Registry } from '../registry.js';

const [home, project, countArg, nArg] = process.argv.slice(2);
const m = validateManifest({
  project,
  baseBranch: 'develop',
  slots: { count: Number(countArg), reserved: [0] },
  ports: { services: { api: { base: 50000 } } },
  services: { api: { start: 'true', stop: 'true', health: 'true' } },
  scopes: { frontend: [], backend: [] },
  areas: { a: {} },
});
const r = Registry.open(home);
const got: number[] = [];
for (let i = 0; i < Number(nArg); i++)
  got.push(
    r.allocateSlot(
      project,
      m,
      { session: `p${process.pid}`, pid: process.pid },
      `e${process.pid}-${i}`,
    ).value as number,
  );
process.stdout.write(`${got.join(',')}\n`);
