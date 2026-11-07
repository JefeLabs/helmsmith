/**
 * The `--json` contract (spec docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md §3):
 * one JSON line on stdout on success; on failure an empty stdout, a JSON error
 * body as stderr's last line, exit 2 (refused) or 1 (broken).
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, makeRepo } from '../../src/test/git-fixture.js';
import { createWorkspace, parseErrorLine, parseJsonLine, runCli, type Workspace } from './helpers.js';

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.cleanup();
  ws = undefined;
  await cleanupFixtures();
});

describe('--json contract: cache', () => {
  it('cache clear --json prints one document and no footer', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ cleared: 0 });
    expect(r.stdout).not.toContain('config:');
  });

  it('cache prune --json', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'prune', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ pruned: 0 });
  });
});

describe('--json contract: usage errors', () => {
  it('an unknown option is USAGE, exit 2, empty stdout', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear', '--json', '--bogus']);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe('');
    expect(parseErrorLine(r.stderr)).toMatchObject({
      code: 'USAGE',
      message: expect.stringMatching(/unknown option/),
    });
  });

  it.each([['connect'], ['init'], ['auth', 'login']])(
    '%s does not take --json → USAGE',
    async (...cmd) => {
      ws = await createWorkspace();
      const r = await runCli(ws, [...cmd, '--json']);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toBe('');
      expect(parseErrorLine(r.stderr).code).toBe('USAGE');
    },
  );

  it('text mode is untouched: no --json keeps the footer on stdout', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`config: ${ws.manifestPath}`);
  });
});

describe('--json contract: manifest CRUD', () => {
  it('group create/remove round trip and refusals', async () => {
    ws = await createWorkspace();
    let r = await runCli(ws, ['group', 'create', 'web', '--desc', 'Web apps', '--json']);
    expect(parseJsonLine(r.stdout)).toStrictEqual({
      created: { group: 'web', description: 'Web apps' },
    });
    r = await runCli(ws, ['group', 'create', 'web', '--json']);
    expect([r.exitCode, r.stdout, parseErrorLine(r.stderr).code]).toEqual([2, '', 'GROUP_EXISTS']);
    r = await runCli(ws, ['group', 'remove', 'web', '--json']);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ removed: { group: 'web' } });
    r = await runCli(ws, ['group', 'remove', 'web', '--json']);
    expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'GROUP_NOT_FOUND']);
  });

  it('repo add/remove with branches, groupCreated and refusals', async () => {
    ws = await createWorkspace();
    let r = await runCli(ws, [
      'repo', 'add', 'web', 'app', './app', '--branches', '{"dev":"develop"}', '--json',
    ]);
    expect(parseJsonLine(r.stdout)).toStrictEqual({
      added: {
        group: 'web',
        groupCreated: true,
        repo: {
          name: 'app',
          path: join(ws.dir, 'app'),
          remote: 'origin',
          url: null,
          branches: { dev: 'develop' },
          tags: [],
        },
      },
    });
    r = await runCli(ws, ['repo', 'add', 'web', 'app', './app', '--json']);
    expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'REPO_EXISTS']);
    r = await runCli(ws, ['repo', 'add', 'web', 'b', './b', '--branches', 'nope', '--json']);
    expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'USAGE']);
    r = await runCli(ws, ['repo', 'remove', 'web', 'app', '--json']);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ removed: { group: 'web', repo: 'app' } });
    r = await runCli(ws, ['repo', 'remove', 'web', 'app', '--json']);
    expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'REPO_NOT_FOUND']);
  });

  it('an invalid manifest is MANIFEST_INVALID', async () => {
    ws = await createWorkspace({ groups: 5 });
    const r = await runCli(ws, ['group', 'create', 'x', '--json']);
    expect([r.exitCode, r.stdout]).toEqual([2, '']);
    expect(parseErrorLine(r.stderr)).toMatchObject({
      code: 'MANIFEST_INVALID',
      details: { path: ws.manifestPath },
    });
  });

  it('text mode keeps its wording and exit 1', async () => {
    ws = await createWorkspace();
    await runCli(ws, ['group', 'create', 'web']);
    const r = await runCli(ws, ['group', 'create', 'web']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Group "web" already exists');
  });
});

describe('--json contract: repo list / tags / tag', () => {
  it('repo list --json with no manifest anywhere is empty, not an error', async () => {
    ws = await createWorkspace();
    await rm(ws.manifestPath);
    const r = await runCli(ws, ['repo', 'list', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout)).toStrictEqual({
      manifest: { path: expect.stringMatching(/gittyup\.yaml$/), exists: false },
      groups: [],
    });
  });

  it('repo list --json always includes tags; repo tags counts them sorted', async () => {
    ws = await createWorkspace({
      workspace: '.',
      groups: {
        web: {
          description: 'Web',
          repos: [
            { name: 'a', path: '/x/a', branches: { dev: 'develop' }, tags: ['web', 'api'] },
            { name: 'b', path: '/x/b', url: 'https://github.com/o/b.git', branches: {}, tags: ['api'] },
          ],
        },
      },
    });
    const list = parseJsonLine((await runCli(ws, ['repo', 'list', '--json'])).stdout);
    expect(list.manifest).toStrictEqual({ path: ws.manifestPath, exists: true });
    expect(list.groups).toStrictEqual([
      {
        name: 'web',
        description: 'Web',
        repos: [
          { name: 'a', path: '/x/a', remote: 'origin', url: null, branches: { dev: 'develop' }, tags: ['web', 'api'] },
          { name: 'b', path: '/x/b', remote: 'origin', url: 'https://github.com/o/b.git', branches: {}, tags: ['api'] },
        ],
      },
    ]);
    expect(parseJsonLine((await runCli(ws, ['repo', 'tags', '--json'])).stdout)).toStrictEqual({
      tags: [
        { tag: 'api', repos: 2 },
        { tag: 'web', repos: 1 },
      ],
    });
  });

  it('repo tag --json needs --add or --remove (no prompt)', async () => {
    ws = await createWorkspace({
      workspace: '.',
      groups: { web: { repos: [{ name: 'a', path: '/x/a', tags: ['old'] }] } },
    });
    let r = await runCli(ws, ['repo', 'tag', '--json']);
    expect([r.exitCode, r.stdout, parseErrorLine(r.stderr).code]).toEqual([2, '', 'INTERACTIVE_ONLY']);
    r = await runCli(ws, ['repo', 'tag', '-g', 'web', '--add', 'api,core', '--remove', 'old', '--json']);
    expect(parseJsonLine(r.stdout)).toStrictEqual({
      updated: [{ repo: 'a', tags: ['api', 'core'] }],
      added: ['api', 'core'],
      removed: ['old'],
    });
  });
});

describe('--json contract: config and auth', () => {
  it('config --json shows defaults and no tokens', async () => {
    ws = await createWorkspace();
    const doc = parseJsonLine((await runCli(ws, ['config', '--json'])).stdout);
    expect(doc).toStrictEqual({
      manifest: { path: ws.manifestPath, location: 'home' },
      settings: {
        aiMode: 'suggest',
        aiModel: 'gpt-4o',
        aiModelIsDefault: true,
        conflictBranchPrefix: 'conflict-resolution',
      },
      agent: { available: false, source: null },
      github: { available: false, source: null },
    });
  });

  it('config --ai/--model --json persists and returns the new settings', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['config', '--ai', 'auto', '--model', 'gpt-5', '--json']);
    expect(parseJsonLine(r.stdout).settings).toStrictEqual({
      aiMode: 'auto',
      aiModel: 'gpt-5',
      aiModelIsDefault: false,
      conflictBranchPrefix: 'conflict-resolution',
    });
    expect(await readFile(ws.manifestPath, 'utf-8')).toContain('ai_mode: auto');
  });

  it('config --ai with an unknown mode is USAGE and leaves the manifest alone', async () => {
    ws = await createWorkspace();
    const before = await readFile(ws.manifestPath, 'utf-8');
    const r = await runCli(ws, ['config', '--ai', 'bogus', '--json']);
    expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'USAGE']);
    expect(await readFile(ws.manifestPath, 'utf-8')).toBe(before);
  });

  it('a GITHUB_TOKEN shows up as the source in both rows (no network)', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['config', '--json'], { env: { GITHUB_TOKEN: 'ghp_test' } });
    const doc = parseJsonLine(r.stdout);
    expect([doc.agent, doc.github]).toEqual([
      { available: true, source: 'env:GITHUB_TOKEN' },
      { available: true, source: 'env:GITHUB_TOKEN' },
    ]);
    expect(r.stdout).not.toContain('ghp_test');
  });

  it('auth status --json with no token, and auth models --json refuses', async () => {
    ws = await createWorkspace();
    expect(parseJsonLine((await runCli(ws, ['auth', 'status', '--json'])).stdout)).toStrictEqual({
      agent: { available: false, source: null, reachable: null },
      github: { available: false, source: null },
    });
    const r = await runCli(ws, ['auth', 'models', '--json']);
    expect([r.exitCode, parseErrorLine(r.stderr).code]).toEqual([2, 'AUTH_REQUIRED']);
  });
});

async function devProdRepo() {
  return makeRepo({
    commits: [
      { message: 'base', files: { 'f.txt': 'x\n' } },
      { branch: 'develop', message: 'dev', files: { 'f.txt': 'y\n' } },
    ],
  });
}

describe('--json contract: status', () => {
  it('reports untracked branches as null ahead/behind with full sha and ISO date', async () => {
    const repo = await devProdRepo();
    ws = await createWorkspace({
      workspace: '.',
      groups: { app: { repos: [{ name: 'fx', path: repo.path, branches: { dev: 'develop', prod: 'main' } }] } },
    });
    const r = await runCli(ws, ['status', '--json']);
    expect(r.exitCode).toBe(0);
    const doc = parseJsonLine(r.stdout);
    expect(doc.manifest).toStrictEqual({ path: ws.manifestPath, exists: true });
    expect(doc.repos[0].branches.dev).toMatchObject({
      branch: 'develop',
      tracking: false,
      ahead: null,
      behind: null,
      lastCommit: {
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    });
    expect(doc.summary).toStrictEqual({ repos: 1, withConflicts: 0, withErrors: 0 });
  });

  it('a repo path that does not exist is an error row, not a failure', async () => {
    const repo = await devProdRepo();
    ws = await createWorkspace({
      workspace: '.',
      groups: {
        app: {
          repos: [
            { name: 'fx', path: repo.path, branches: { dev: 'develop' } },
            { name: 'gone', path: join(repo.path, 'no-such-dir'), branches: { dev: 'develop' } },
          ],
        },
      },
    });
    const r = await runCli(ws, ['status', '--json']);
    expect(r.exitCode).toBe(0);
    const doc = parseJsonLine(r.stdout);
    expect(doc.repos).toHaveLength(2);
    expect(doc.repos[1]).toMatchObject({
      name: 'gone',
      currentBranch: null,
      error: expect.stringMatching(/not found/),
      branches: {},
    });
    expect(doc.summary.withErrors).toBe(1);
  });

  it('an unknown group is TARGET_UNKNOWN', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['status', '-g', 'nope', '--json']);
    expect([r.exitCode, r.stdout]).toEqual([2, '']);
    expect(parseErrorLine(r.stderr)).toMatchObject({ code: 'TARGET_UNKNOWN', details: { target: 'nope' } });
  });

  it('no manifest anywhere is an empty report', async () => {
    ws = await createWorkspace();
    await rm(ws.manifestPath);
    const r = await runCli(ws, ['status', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout)).toMatchObject({ repos: [], manifest: { exists: false } });
  });

  it('status --fetch --json reports a failed fetch and still exits 0', async () => {
    const repo = await devProdRepo();
    ws = await createWorkspace({
      workspace: '.',
      groups: { app: { repos: [{ name: 'fx', path: repo.path, branches: { dev: 'develop' } }] } },
    });
    const r = await runCli(ws, ['status', '--fetch', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout).fetch).toEqual([{ repo: 'fx', ok: false, error: expect.any(String) }]);
  });

  it('text status shows – for an untracked ahead/behind', async () => {
    const repo = await devProdRepo();
    ws = await createWorkspace({
      workspace: '.',
      groups: { app: { repos: [{ name: 'fx', path: repo.path, branches: { dev: 'develop' } }] } },
    });
    const r = await runCli(ws, ['status']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('–');
  });
});
