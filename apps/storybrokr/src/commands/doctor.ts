import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveHost } from '../lib/host.js';
import { fail, printJson } from './_shared/output.js';

/** Runs in-process (no daemon) so it works even when the daemon cannot start. */
export function registerDoctor(program: Command): void {
  program
    .command('doctor [path]')
    .description(
      'Check that a host repo can be brokered: .storybook, storybook binary, framework, tsconfig paths',
    )
    .option('--json', 'print JSON')
    .action((path: string | undefined, o: { json?: boolean }) => {
      try {
        const host = resolveHost(path ?? process.cwd());
        if (o.json) return printJson(host);
        console.log(`${chalk.green('ok')}  host       ${host.hostRoot}`);
        console.log(`${chalk.green('ok')}  main       ${host.mainFile}`);
        console.log(
          `${host.previewFile ? chalk.green('ok') : chalk.yellow('--')}  preview    ${host.previewFile ?? 'none'}`,
        );
        console.log(
          `${chalk.green('ok')}  storybook  ${host.storybookVersion} (${host.storybookBin})`,
        );
        console.log(
          `${host.framework === 'unknown' ? chalk.yellow('??') : chalk.green('ok')}  framework  ${host.framework}`,
        );
        console.log(
          `${chalk.green('ok')}  aliases    ${Object.keys(host.tsconfigPaths).join(', ') || 'none'}`,
        );
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
