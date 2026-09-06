import type { Command } from 'commander';
import { runStdio } from '../mcp/server.js';

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('Serve the MCP stdio interface (thin client of the daemon)')
    .action(async () => {
      await runStdio();
    });
}
