import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, resolveTarget } from './_shared/output.js';

function openUrl(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  }).unref();
}

export function registerOpen(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('open <id-or-path>')
    .description('Open an instance in the browser')
    .option('--host <dir>', 'host repo root')
    .option('--story <id>', 'open one story instead of the manager')
    .action(async (idOrPath: string, o: { host?: string; story?: string }) => {
      try {
        const target = resolveTarget(idOrPath, o.host);
        const record = await (await connect()).get(target.idOrPath, {
          host: target.host,
          hint: target.hint,
        });
        const story = o.story ? record.stories.find((s) => s.id === o.story) : undefined;
        if (o.story && !story) throw new Error(`no story ${o.story} in ${record.id}`);
        const url = story ? story.url : record.url;
        console.log(url);
        openUrl(url);
      } catch (err) {
        fail(err, false);
      }
    });
}
