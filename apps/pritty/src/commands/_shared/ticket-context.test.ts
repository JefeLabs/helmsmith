import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedTicket, setCachedTicket } from '../../adapters/cache.js';
import { buildAdapter } from '../../adapters/index.js';
import { ConfigSchema } from '../../config.js';
import type { GitOps } from '../../git.js';
import { lookupTicket, resolveTicketContext } from './ticket-context.js';

vi.mock('../../adapters/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../adapters/index.js')>()),
  buildAdapter: vi.fn(),
}));

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

describe('lookupTicket', () => {
  const validated = ConfigSchema.parse({
    ticket: { pattern: 'PROJ-\\d+', validation: { type: 'jira-cli' } },
  });
  const home = process.env.PRITTY_HOME;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pritty-lookup-test-'));
    process.env.PRITTY_HOME = tmp;
    vi.mocked(buildAdapter).mockReset();
  });

  afterEach(() => {
    if (home === undefined) delete process.env.PRITTY_HOME;
    else process.env.PRITTY_HOME = home;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the cached result without calling the adapter', async () => {
    setCachedTicket('PROJ-7', 'jira-cli', { exists: true, title: 'Fix login', url: 'https://x/7' });
    expect(await lookupTicket(validated, 'PROJ-7')).toEqual({
      exists: true,
      title: 'Fix login',
      url: 'https://x/7',
    });
    expect(buildAdapter).not.toHaveBeenCalled();
  });

  it('asks the adapter on a miss and caches its answer', async () => {
    const validate = vi.fn(async () => ({ exists: false, error: 'no such issue' }));
    vi.mocked(buildAdapter).mockResolvedValue({
      name: 'jira-cli',
      isAvailable: async () => true,
      validate,
    });
    expect(await lookupTicket(validated, 'PROJ-8')).toEqual({
      exists: false,
      error: 'no such issue',
    });
    expect(validate).toHaveBeenCalledWith('PROJ-8');
    expect(getCachedTicket('PROJ-8', 'jira-cli')).toMatchObject({ exists: false });
  });

  it('returns null without ticket.validation, and throws what the adapter throws', async () => {
    expect(await lookupTicket(config, 'PROJ-7')).toBeNull();
    vi.mocked(buildAdapter).mockRejectedValue(new Error('jira not on PATH'));
    await expect(lookupTicket(validated, 'PROJ-9')).rejects.toThrow('jira not on PATH');
  });

  it('leaves resolveTicketContext warning and carrying on when the adapter fails', async () => {
    vi.mocked(buildAdapter).mockRejectedValue(new Error('jira not on PATH'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const ctx = await resolveTicketContext(validated, 'feature/PROJ-9-x', staleGit);
      expect(ctx?.ticket).toBe('PROJ-9');
      expect(err.mock.calls.flat().join('\n')).toMatch(
        /Ticket validation failed: jira not on PATH/,
      );
      expect(log.mock.calls.flat().join('\n')).toMatch(/couldn't verify PROJ-9 via jira-cli/);
    } finally {
      err.mockRestore();
      log.mockRestore();
    }
  });
});
