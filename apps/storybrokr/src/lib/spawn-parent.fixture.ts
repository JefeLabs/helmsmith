// Fixture for spawn.test.ts: a stand-in daemon that spawns one Storybook through the real
// spawner, prints the child's pid, then idles until it is killed.
import { join } from 'node:path';
import type { HostInfo } from '../types.js';
import { storybookSpawner } from './spawn.js';

const [root, configDir] = process.argv.slice(2) as [string, string];
const host: HostInfo = {
  hostRoot: root,
  storybookDir: join(root, '.storybook'),
  mainFile: join(root, '.storybook', 'main.ts'),
  previewFile: null,
  managerFile: null,
  framework: 'unknown',
  storybookBin: join(root, 'bin.sh'),
  storybookVersion: '0',
  tsconfigPaths: {},
};
const proc = storybookSpawner.spawn(host, configDir, 6199);
console.log(String(proc.pid));
setInterval(() => {}, 1000);
