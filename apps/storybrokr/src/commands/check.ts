import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { collect, formatCheckResults, waitForFrom } from './_shared/inspect.js';
import { fail, parseIntegerInRange, printJson, resolveTarget } from './_shared/output.js';

interface CheckOpts {
  host?: string;
  story: string[];
  waitForText?: string;
  waitForSelector?: string;
  timeout?: number;
  concurrency?: number;
  json?: boolean;
}

export function registerCheck(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('check <id-or-path>')
    .description('Run stories headlessly (play functions included) and report pass/fail per story')
    .option('--host <dir>', 'host repo root')
    .option('--story <id>', 'story id to check; repeatable (default: every story)', collect, [])
    .option('--wait-for-text <text>', 'after render, also wait for this visible text')
    .option('--wait-for-selector <selector>', 'after render, also wait for this selector')
    .option(
      '--timeout <ms>',
      'per-story budget, 1000-300000 (default 30000)',
      parseIntegerInRange(1000, 300_000),
    )
    .option(
      '--concurrency <n>',
      'max parallel browser contexts, 1-16 (default 4)',
      parseIntegerInRange(1, 16),
    )
    .option('--json', 'print JSON')
    .action(async (idOrPath: string, o: CheckOpts) => {
      try {
        const target = resolveTarget(idOrPath, o.host);
        const res = await (await connect()).check(
          target.idOrPath,
          {
            storyIds: o.story.length > 0 ? o.story : undefined,
            waitFor: waitForFrom(o),
            timeoutMs: o.timeout,
            ...(o.concurrency !== undefined ? { concurrency: o.concurrency } : {}),
          },
          { host: target.host, hint: target.hint },
        );
        if (o.json) printJson(res);
        else for (const line of formatCheckResults(res)) console.log(line);
        if (res.summary.fail + res.summary.timeout > 0) process.exit(1);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
