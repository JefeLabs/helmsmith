import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import type { InstanceRecord } from '../types.js';
import { fail, printInstance, printJson, resolveComponent } from './_shared/output.js';

export interface UpOptions {
  component: string;
  hostRoot?: string;
  ttl?: number;
  wait?: boolean;
}

export async function runUp(
  client: DaemonClient,
  opts: UpOptions,
): Promise<{ record: InstanceRecord; created: boolean }> {
  return client.up({
    component: opts.component,
    hostRoot: opts.hostRoot,
    ttlMinutes: opts.ttl,
    wait: opts.wait !== false,
  });
}

export function registerUp(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('up <path>')
    .description('Boot (or reuse) a single-component Storybook for the component at <path>')
    .option(
      '--host <dir>',
      'host repo root (default: walk up from <path> to the nearest .storybook/)',
    )
    .option('--ttl <minutes>', 'idle minutes before the instance is reaped; 0 = never', (v) =>
      Number(v),
    )
    .option(
      '--no-wait',
      'return as soon as the instance is registered instead of waiting for ready',
    )
    .option('--json', 'print the instance record as JSON')
    .action(
      async (path: string, o: { host?: string; ttl?: number; wait: boolean; json?: boolean }) => {
        try {
          const target = o.host
            ? { component: path.replace(/\/+$/, ''), hostRoot: resolve(o.host) }
            : resolveComponent(path);
          const client = await connect();
          const { record } = await runUp(client, { ...target, ttl: o.ttl, wait: o.wait });
          if (o.json) printJson(record);
          else printInstance(record);
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
