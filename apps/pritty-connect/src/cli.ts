import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runConnectView } from '@helmsmith/tui-view-components';
import { Command } from 'commander';
import { githubCopilotConnection } from './connections.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string };

const program = new Command()
  .name('pritty-connect')
  .description("pritty's interactive connections view: GitHub Copilot login status, login, logout")
  .version(pkg.version)
  .action(async () => {
    await runConnectView({ appName: 'pritty', required: [githubCopilotConnection] });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
