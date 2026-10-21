import { afterEach, describe, expect, it } from 'vitest';
import type { RepoConfig } from '../config/schema.js';
import { cleanupFixtures, makeRepo } from '../test/git-fixture.js';
import { scriptedPrompts } from '../test/scripted-prompts.js';
import { ConflictResolver } from './conflict-resolver.js';
import { GitOperations } from './git-operations.js';

afterEach(() => cleanupFixtures());

const EIGHT = (l4: string) => `line1\nline2\nline3\n${l4}\nline5\nline6\nline7\nline8\n`;
const repoCfg: RepoConfig = { name: 'r', path: '.', remote: 'origin', branches: {}, tags: [] };

async function conflicted() {
  const repo = await makeRepo({
    commits: [
      { message: 'base', files: { 'f.txt': EIGHT('line4') } },
      { branch: 'develop', message: 'ours', files: { 'f.txt': EIGHT('line4-ours') } },
      { branch: 'main', message: 'theirs', files: { 'f.txt': EIGHT('line4-theirs') } },
    ],
    checkout: 'develop',
  });
  await repo.git.merge(['main']).catch(() => {});
  return { repo, git: new GitOperations(repo.path) };
}

describe('ConflictResolver', () => {
  it('AI auto writes the complete file after confirmation', async () => {
    const { repo, git } = await conflicted();
    const prompts = scriptedPrompts(['ai-auto', true, true]); // menu, write?, commit?
    const resolver = new ConflictResolver(git, repoCfg, 'auto', {
      prompts,
      onAiResolve: async () => `\`\`\`\n${EIGHT('line4-merged')}\`\`\``,
    });
    const session = await resolver.startSession('merge', 'main', 'develop');
    expect(session.status).toBe('resolved');
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-merged'));
  });

  it('AI auto returning a fragment is refused and falls back to the menu', async () => {
    const { repo, git } = await conflicted();
    const prompts = scriptedPrompts(['ai-auto', 'ours', true]);
    const resolver = new ConflictResolver(git, repoCfg, 'auto', {
      prompts,
      onAiResolve: async () => 'line4-merged',
    });
    const session = await resolver.startSession('merge', 'main', 'develop');
    expect(session.status).toBe('resolved');
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-ours'));
  });

  it('AI suggest accepts only the last fenced block', async () => {
    const { repo, git } = await conflicted();
    const prompts = scriptedPrompts(['ai-suggest', 'accept', true]);
    const resolver = new ConflictResolver(git, repoCfg, 'suggest', {
      prompts,
      onAiResolve: async () => `I kept both.\n\n\`\`\`\n${EIGHT('line4-both')}\`\`\``,
    });
    await resolver.startSession('merge', 'main', 'develop');
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-both'));
  });

  it('manual edit opens the marked file and writes the edited whole file', async () => {
    const { repo, git } = await conflicted();
    const [file] = await git.getConflictedFiles();
    const prompts = scriptedPrompts(['manual', EIGHT('line4-manual'), true]);
    const resolver = new ConflictResolver(git, repoCfg, 'manual', { prompts });
    await resolver.startSession('merge', 'main', 'develop');
    const editorCall = prompts.calls.find((c) => c.kind === 'editor');
    expect(editorCall?.default).toBe(file.markedContent);
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-manual'));
  });

  it('manual edit that keeps markers is not written and skips after declining to reopen', async () => {
    const { repo, git } = await conflicted();
    const [file] = await git.getConflictedFiles();
    const prompts = scriptedPrompts(['manual', file.markedContent, false, 'leave']);
    const resolver = new ConflictResolver(git, repoCfg, 'manual', { prompts });
    const session = await resolver.startSession('merge', 'main', 'develop');
    expect(session.status).toBe('in-progress');
    expect(await repo.read('f.txt')).toBe(file.markedContent);
    expect((await repo.git.status()).conflicted).toEqual(['f.txt']);
  });

  it('offers no AI or manual options when the file has no hunks', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'delete', files: { 'f.txt': null } },
        { branch: 'main', message: 'modify', files: { 'f.txt': 'x-main\n' } },
      ],
      checkout: 'develop',
    });
    await repo.git.merge(['main']).catch(() => {});
    const prompts = scriptedPrompts(['theirs', true]);
    const resolver = new ConflictResolver(new GitOperations(repo.path), repoCfg, 'auto', {
      prompts,
    });
    await resolver.startSession('merge', 'main', 'develop');
    const menu = prompts.calls.find((c) => c.kind === 'select');
    expect(menu?.choices).toEqual(['ours', 'theirs', 'skip']);
    expect(await repo.read('f.txt')).toBe('x-main\n');
  });

  it('with yes: true, AI auto writes without a confirmation prompt', async () => {
    const { git } = await conflicted();
    const prompts = scriptedPrompts(['ai-auto', true]); // menu, commit?
    const resolver = new ConflictResolver(git, repoCfg, 'auto', {
      prompts,
      yes: true,
      onAiResolve: async () => EIGHT('m'),
    });
    const session = await resolver.startSession('merge', 'main', 'develop');
    expect(session.status).toBe('resolved');
    expect(prompts.calls.filter((c) => c.kind === 'confirm').map((c) => c.message)).toEqual([
      'Commit the resolution?',
    ]);
  });
});
