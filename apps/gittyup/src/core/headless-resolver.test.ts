/**
 * The no-prompt resolver behind `merge`/`pick --json`: the agent tries each conflicted
 * file in order, the first failure stops the walk, and nothing ever prompts. Real repos
 * in a real conflict; the agent is a fake.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { makeConflictRepo } from '../test/conflict-fixture.js';
import { cleanupFixtures, makeRepo } from '../test/git-fixture.js';
import type { AgentReply } from './copilot-agent.js';
import { GitOperations } from './git-operations.js';
import { type HeadlessAgent, resolveConflictsHeadless } from './headless-resolver.js';

afterAll(cleanupFixtures);

const agent = (reply: AgentReply | null, extra: Partial<HeadlessAgent> = {}): HeadlessAgent => ({
  mode: 'auto',
  reply,
  ...extra,
});

/** The fixture repo, mid-merge of feature → main with f.txt conflicted. */
async function conflicted() {
  const repo = await makeConflictRepo();
  const git = new GitOperations(repo.path);
  expect((await git.merge('feature', 'main')).success).toBe(false);
  return { repo, git };
}

describe('resolveConflictsHeadless', () => {
  it('writes and stages the agent’s file when the gate accepts it', async () => {
    const { repo, git } = await conflicted();

    const result = await resolveConflictsHeadless(
      git,
      agent(async () => 'a\nRESOLVED\nc\n'),
    );

    expect(result).toEqual({ resolved: true, conflicts: [{ path: 'f.txt', outcome: 'resolved' }] });
    expect(await repo.read('f.txt')).toBe('a\nRESOLVED\nc\n');
    expect((await git.getStatus()).conflicted).toEqual([]);
  });

  it('unwraps a reply fenced in a code block', async () => {
    const { repo, git } = await conflicted();

    const result = await resolveConflictsHeadless(
      git,
      agent(async () => '```\na\nRESOLVED\nc\n```\n'),
    );

    expect(result.resolved).toBe(true);
    expect(await repo.read('f.txt')).toBe('a\nRESOLVED\nc\n');
  });

  it('refuses a reply the gate rejects and leaves the file conflicted', async () => {
    const { git } = await conflicted();

    const result = await resolveConflictsHeadless(
      git,
      agent(async () => '<<<<<<< x\n'),
    );

    expect(result).toEqual({
      resolved: false,
      conflicts: [
        { path: 'f.txt', outcome: 'agent_refused', reason: 'still contains conflict markers' },
      ],
    });
    expect((await git.getStatus()).conflicted).toEqual(['f.txt']);
  });

  it('reports an agent that throws as agent_error', async () => {
    const { git } = await conflicted();

    const result = await resolveConflictsHeadless(
      git,
      agent(async () => {
        throw new Error('rate limited');
      }),
    );

    expect(result.conflicts).toEqual([
      { path: 'f.txt', outcome: 'agent_error', reason: 'rate limited' },
    ]);
  });

  it('marks every file agent_unavailable when there is no agent', async () => {
    const { git } = await conflicted();

    const result = await resolveConflictsHeadless(
      git,
      agent(null, { unavailableReason: 'no token' }),
    );

    expect(result).toEqual({
      resolved: false,
      conflicts: [{ path: 'f.txt', outcome: 'agent_unavailable', reason: 'no token' }],
    });
  });

  it('attempts nothing in manual mode', async () => {
    const { git } = await conflicted();
    const reply = vi.fn(async () => 'a\nRESOLVED\nc\n');

    const result = await resolveConflictsHeadless(git, agent(reply, { mode: 'manual' }));

    expect(result.conflicts).toEqual([
      { path: 'f.txt', outcome: 'not_attempted', reason: 'ai mode is manual' },
    ]);
    expect(reply).not.toHaveBeenCalled();
  });

  it('tags every row with the commit being picked', async () => {
    const { git } = await conflicted();

    const result = await resolveConflictsHeadless(
      git,
      agent(null, { unavailableReason: 'x' }),
      'abc',
    );

    expect(result.conflicts.every((c) => c.commit === 'abc')).toBe(true);
  });

  it('stops at the first file it cannot resolve; later files are not attempted', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'a\nb\nc\n', 'h.txt': '1\n2\n3\n' } },
        {
          branch: 'feature',
          from: 'main',
          message: 'feat',
          files: { 'f.txt': 'a\nFEATURE\nc\n', 'h.txt': '1\nFEAT\n3\n' },
        },
        {
          branch: 'main',
          message: 'main',
          files: { 'f.txt': 'a\nMAIN\nc\n', 'h.txt': '1\nMAIN\n3\n' },
        },
      ],
    });
    const git = new GitOperations(repo.path);
    expect((await git.merge('feature', 'main')).success).toBe(false);
    const reply = vi.fn(async () => '<<<<<<< x\n');

    const result = await resolveConflictsHeadless(git, agent(reply));

    expect(result).toEqual({
      resolved: false,
      conflicts: [
        { path: 'f.txt', outcome: 'agent_refused', reason: 'still contains conflict markers' },
        {
          path: 'h.txt',
          outcome: 'not_attempted',
          reason: 'an earlier file in this repo was not resolved',
        },
      ],
    });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('never sends a binary file to the agent', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'bin.dat': 'x\0base\n' } },
        { branch: 'feature', from: 'main', message: 'feat', files: { 'bin.dat': 'x\0feature\n' } },
        { branch: 'main', message: 'main', files: { 'bin.dat': 'x\0main\n' } },
      ],
    });
    const git = new GitOperations(repo.path);
    expect((await git.merge('feature', 'main')).success).toBe(false);
    const reply = vi.fn(async () => 'text');

    const result = await resolveConflictsHeadless(git, agent(reply));

    expect(result).toEqual({
      resolved: false,
      conflicts: [{ path: 'bin.dat', outcome: 'agent_refused', reason: 'binary file' }],
    });
    expect(reply).not.toHaveBeenCalled();
  });
});
