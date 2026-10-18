import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../config.js';
import type { GitOps } from '../../git.js';
import { resolveTicketContext } from './ticket-context.js';

const config = ConfigSchema.parse({
  ticket: { pattern: 'PROJ-\\d+', inferFromCommits: true, freshWindowHours: 24 },
});
const staleGit = {
  recentCommitsOnBranch: async () => [
    {
      hash: 'a',
      subject: 'PROJ-7 earlier work',
      dateISO: new Date(Date.now() - 72 * 3600_000).toISOString(),
    },
  ],
} as unknown as GitOps;

describe('resolveTicketContext and the stale-ticket question', () => {
  it('does not ask, and does not reuse the stale ticket, when running non-interactively', async () => {
    let asked = 0;
    const ctx = await resolveTicketContext(config, 'feature/no-ticket', staleGit, {
      interactive: false,
      ask: async () => {
        asked++;
        return true;
      },
    });
    expect(asked).toBe(0);
    expect(ctx?.ticket ?? null).toBeNull();
  });

  it('asks when interactive, and reuses the ticket on yes', async () => {
    const ctx = await resolveTicketContext(config, 'feature/no-ticket', staleGit, {
      interactive: true,
      ask: async () => true,
    });
    expect(ctx?.ticket).toBe('PROJ-7');
  });
});
