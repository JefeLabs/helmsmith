# gittyup Whole-File Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every conflict resolution path in gittyup write a complete file: never a hunk fragment, never conflict markers, never model prose.

**Architecture:** `ConflictFile` carries the full file from each index stage (`git show :1/:2/:3`) plus the marked working-tree content; the hunk parser survives only for the preview. One gate, `checkResolution`, sits in front of the single write path `applyResolution`, and every strategy (AI auto, AI suggest, manual edit) goes through it. The resolver takes its prompts through an injectable `ResolverPrompts` seam so its flows are unit-tested with scripted answers against real git fixtures. The AI prompt sends full files and asks for a full file back; helper functions strip fences and extract the last fenced block.

**Tech Stack:** simple-git 3, @inquirer/prompts 8, vitest 5, the `makeRepo` fixture from slice 3.10.

**Spec:** `docs/superpowers/specs/2026-10-19-gittyup-hardening-design.md` — slice §3.1 (fixes problems §1.1 and §1.2), plus the `ai_model` setting.

## Global Constraints

- Every resolved file is written by `GitOperations.applyResolution` and nowhere else (spec §3.1 "Writes go through one gate").
- The gate refuses: content matching `/^(<{7}|={7}|>{7}|\|{7})( |\r|$)/m`; empty content when neither side was empty; single-line content when `ours` and `theirs` both exceed one line (spec §3.1).
- A missing index stage is `undefined`, never `''` (spec §3.1).
- `settings.ai_model` is optional, default `'gpt-4o'` (spec §3.1).
- AI auto writes require confirmation unless `--yes` (spec §3.1).
- Unit tests are co-located and use `makeRepo` from `src/test/git-fixture.ts`; no new e2e tests in this slice (see Ruling in §Review Focus 0).
- No change to merge/cherry-pick orchestration, stash handling, PRs, or escalation (slices 3.2–3.5).
- Changeset: `@helmsmith/gittyup` minor. Menu copy no longer says "Claude"; it says "AI" and names the configured model.

## Review Focus

0. **Ruling, recorded here for the executor:** the spec §7 e2e case "merge --no-fetch driven by stdin answers" is not implementable. Verified 2026-10-19 against the built CLI: inquirer consumes the first prompt's keystrokes from a pipe, and once stdin reaches EOF every later prompt exits immediately, dropping the remaining bytes. The resolver's flows are therefore unit-tested through the prompt seam (Task 4), and the spec's §7 bullet is amended in Task 5.
1. A file with CRLF line endings: markers end in `\r`, the gate must still see them, and the hunk parser must still split. Test: Task 2 "sees markers on CRLF lines"; Task 1 "parses hunks in a CRLF file".
2. A conflict with no textual hunks (binary file, or both sides changed mode only): the AI and manual options would write garbage. The menu offers only ours/theirs/skip. Test: Task 4 "offers no AI or manual options when the file has no hunks".
3. The user closes the editor without changing anything: markers remain, the gate refuses, the resolver offers to reopen, and declining leaves the file unwritten and unstaged. Test: Task 4 "manual edit that keeps markers is not written and skips after declining to reopen".
4. The model wraps its answer in a fence with a language tag (```ts) or returns two fenced blocks: auto strips exactly one outer fence; suggest takes the last block. Test: Task 3 table.
5. A conflicted path with spaces or nested directories: stage reads and writes must quote nothing and resolve under the repo root. Test: Task 1 "reads stages for a nested path with spaces".

---

### Task 1: `ConflictFile` carries full files from the index stages

**Files:**
- Modify: `apps/gittyup/src/config/schema.ts:121-127` (`ConflictFile`)
- Modify: `apps/gittyup/src/core/git-operations.ts:200-260` (`getConflictedFiles`, `parseConflictMarkers`, `resolveUseOurs`, `resolveUseTheirs`)
- Test: `apps/gittyup/src/core/git-operations.test.ts` (new)

**Interfaces:**
- Consumes: `makeRepo`, `cleanupFixtures` from `src/test/git-fixture.ts`.
- Produces:

```ts
// src/config/schema.ts
export interface ConflictHunk { ours: string; theirs: string; base?: string }
export interface ConflictFile {
  path: string;
  /** working-tree content with markers; '' when the file is absent on disk */
  markedContent: string;
  ours?: string;   // git show :2:<path>; undefined when that side deleted the file
  theirs?: string; // git show :3:<path>
  base?: string;   // git show :1:<path>
  hunks: ConflictHunk[];
}
// src/core/git-operations.ts
export function parseConflictHunks(marked: string): ConflictHunk[];   // exported, pure
class GitOperations {
  getConflictedFiles(): Promise<ConflictFile[]>;
  resolveUseOurs(path: string): Promise<void>;   // deletes the file when ours is undefined
  resolveUseTheirs(path: string): Promise<void>; // deletes the file when theirs is undefined
}
```

`mergedContent` is removed from `ConflictFile` (nothing reads it).

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/git-operations.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, makeRepo } from '../test/git-fixture.js';
import { GitOperations, parseConflictHunks } from './git-operations.js';

afterEach(() => cleanupFixtures());

const EIGHT = (l4: string) => `line1\nline2\nline3\n${l4}\nline5\nline6\nline7\nline8\n`;

async function conflictedRepo(files: { base: string; ours: string; theirs: string }, path = 'f.txt') {
  const repo = await makeRepo({
    commits: [
      { message: 'base', files: { [path]: files.base } },
      { branch: 'develop', message: 'ours', files: { [path]: files.ours } },
      { branch: 'main', message: 'theirs', files: { [path]: files.theirs } },
    ],
    checkout: 'develop',
  });
  await repo.git.merge(['main']).catch(() => {});
  return repo;
}

describe('getConflictedFiles', () => {
  it('returns the full file for each side, not just the hunk', async () => {
    const repo = await conflictedRepo({ base: EIGHT('line4'), ours: EIGHT('line4-ours'), theirs: EIGHT('line4-theirs') });
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.path).toBe('f.txt');
    expect(file.ours).toBe(EIGHT('line4-ours'));
    expect(file.theirs).toBe(EIGHT('line4-theirs'));
    expect(file.base).toBe(EIGHT('line4'));
    expect(file.markedContent).toContain('<<<<<<< HEAD');
    expect(file.hunks).toEqual([{ ours: 'line4-ours', theirs: 'line4-theirs' }]);
  });

  it('parses two hunks in one file', async () => {
    const repo = await conflictedRepo({
      base: 'a\nb\nc\nd\ne\nf\ng\n',
      ours: 'a-ours\nb\nc\nd\ne\nf\ng-ours\n',
      theirs: 'a-theirs\nb\nc\nd\ne\nf\ng-theirs\n',
    });
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.hunks).toHaveLength(2);
    expect(file.hunks[1]).toEqual({ ours: 'g-ours', theirs: 'g-theirs' });
  });

  it('leaves a deleted side undefined (delete/modify)', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'delete', files: { 'f.txt': null } },
        { branch: 'main', message: 'modify', files: { 'f.txt': 'x-main\n' } },
      ],
      checkout: 'develop',
    });
    await repo.git.merge(['main']).catch(() => {});
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.ours).toBeUndefined();
    expect(file.theirs).toBe('x-main\n');
    expect(file.base).toBe('x\n');
    expect(file.hunks).toEqual([]);
  });

  it('reads stages for a nested path with spaces', async () => {
    const path = 'src/a b/f.txt';
    const repo = await conflictedRepo({ base: 'x\n', ours: 'x-ours\n', theirs: 'x-theirs\n' }, path);
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.path).toBe(path);
    expect(file.ours).toBe('x-ours\n');
  });
});

describe('parseConflictHunks', () => {
  it('parses hunks in a CRLF file', () => {
    const marked = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> main\r\nz\r\n';
    expect(parseConflictHunks(marked)).toEqual([{ ours: 'ours', theirs: 'theirs' }]);
  });

  it('captures the base section of a diff3-style hunk', () => {
    const marked = '<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> main\n';
    expect(parseConflictHunks(marked)).toEqual([{ ours: 'ours', theirs: 'theirs', base: 'base' }]);
  });
});

describe('resolveUseOurs / resolveUseTheirs with a deleted side', () => {
  it('keeping the deleted side removes the file and stages the deletion', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'delete', files: { 'f.txt': null } },
        { branch: 'main', message: 'modify', files: { 'f.txt': 'x-main\n' } },
      ],
      checkout: 'develop',
    });
    await repo.git.merge(['main']).catch(() => {});
    await new GitOperations(repo.path).resolveUseOurs('f.txt');
    expect(await repo.exists('f.txt')).toBe(false);
    const status = await repo.git.status();
    expect(status.conflicted).toEqual([]);
    expect(status.deleted).toContain('f.txt');
  });

  it('keeping the surviving side restores its content and stages it', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'delete', files: { 'f.txt': null } },
        { branch: 'main', message: 'modify', files: { 'f.txt': 'x-main\n' } },
      ],
      checkout: 'develop',
    });
    await repo.git.merge(['main']).catch(() => {});
    await new GitOperations(repo.path).resolveUseTheirs('f.txt');
    expect(await repo.read('f.txt')).toBe('x-main\n');
    expect((await repo.git.status()).conflicted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/gittyup && pnpm exec vitest run src/core/git-operations.test.ts`
Expected: FAIL — `parseConflictHunks` is not exported; `file.ours` is `undefined` where a full string is expected.

- [ ] **Step 3: Implement**

- `parseConflictHunks(marked)`: split on `/\r?\n/`; state machine over `<<<<<<<`, `|||||||`, `=======`, `>>>>>>>` prefixes; push a hunk at each `>>>>>>>`; join sections with `\n`, `base` only when a `|||||||` section was seen. Delete `parseConflictMarkers`.
- `getConflictedFiles()`: for each path in `status.conflicted`, `markedContent` = `readFileSync` or `''` when `ENOENT`; `ours/theirs/base` = `await this.git.show([':2:' + path])` etc. each wrapped so a failing `show` yields `undefined` (git exits 128 when the stage is absent); `hunks = parseConflictHunks(markedContent)`.
- `resolveUseOurs(path)`: if `git show :2:path` fails → `git rm -q --cached path` then unlink the working-tree file if present; else `checkout --ours` + `add` as today. Mirror for theirs with `:3:`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/gittyup && pnpm exec vitest run src/core/git-operations.test.ts`
Expected: PASS, 8 tests. Then `pnpm typecheck` — expect errors only in `conflict-resolver.ts` and `orchestrator.ts` (they still read `oursContent`); those are fixed in Tasks 4 and 5. Note the count in the ledger.

- [ ] **Step 5: Commit**

```bash
git add apps/gittyup/src/config/schema.ts apps/gittyup/src/core/git-operations.ts apps/gittyup/src/core/git-operations.test.ts
git commit -m "feat(gittyup): ConflictFile carries full files from the index stages"
```

---

### Task 2: The resolution gate and the single write path

**Files:**
- Create: `apps/gittyup/src/core/resolution-gate.ts`
- Test: `apps/gittyup/src/core/resolution-gate.test.ts`
- Modify: `apps/gittyup/src/core/git-operations.ts` (replace `resolveFile` with `applyResolution`)
- Test: `apps/gittyup/src/core/git-operations.test.ts` (add two cases)

**Interfaces:**
- Consumes: `ConflictFile` from Task 1.
- Produces:

```ts
// src/core/resolution-gate.ts
export type GateVerdict = { ok: true } | { ok: false; reason: string };
export const MARKER_RE = /^(<{7}|={7}|>{7}|\|{7})( |\r|$)/m;
export function checkResolution(content: string, file: Pick<ConflictFile, 'ours' | 'theirs'>): GateVerdict;
export class ResolutionRejected extends Error { constructor(public readonly path: string, public readonly reason: string) }
// src/core/git-operations.ts
class GitOperations {
  /** The only path that writes a resolved file. Throws ResolutionRejected when the gate refuses. */
  applyResolution(file: ConflictFile, content: string): Promise<void>;
}
```

Reasons (exact copy, tests assert on them): `'still contains conflict markers'`, `'empty resolution while both sides have content'`, `'single line where both sides are multi-line'`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/resolution-gate.test.ts
import { describe, expect, it } from 'vitest';
import { checkResolution } from './resolution-gate.js';

const sides = { ours: 'a\nb\nc\n', theirs: 'a\nB\nc\n' };

describe('checkResolution', () => {
  it('accepts a complete merged file', () => {
    expect(checkResolution('a\nb\nB\nc\n', sides)).toEqual({ ok: true });
  });
  it('rejects content that still contains conflict markers', () => {
    expect(checkResolution('a\n<<<<<<< HEAD\nb\n=======\nB\n>>>>>>> main\nc\n', sides)).toEqual({ ok: false, reason: 'still contains conflict markers' });
  });
  it('sees markers on CRLF lines', () => {
    expect(checkResolution('a\r\n=======\r\nc\r\n', sides).ok).toBe(false);
  });
  it('rejects an empty resolution when both sides have content', () => {
    expect(checkResolution('', sides)).toEqual({ ok: false, reason: 'empty resolution while both sides have content' });
  });
  it('accepts an empty resolution when one side is empty', () => {
    expect(checkResolution('', { ours: '', theirs: 'x\n' })).toEqual({ ok: true });
  });
  it('rejects a single line when both sides are multi-line', () => {
    expect(checkResolution('just one line', sides)).toEqual({ ok: false, reason: 'single line where both sides are multi-line' });
  });
  it('accepts a single line when a side is single-line', () => {
    expect(checkResolution('x', { ours: 'x', theirs: 'y\nz\n' })).toEqual({ ok: true });
  });
  it('does not treat a deleted side as content', () => {
    expect(checkResolution('', { ours: undefined, theirs: 'x\n' })).toEqual({ ok: true });
  });
});
```

Add to `git-operations.test.ts`:

```ts
describe('applyResolution', () => {
  it('writes and stages a gated resolution', async () => {
    const repo = await conflictedRepo({ base: EIGHT('line4'), ours: EIGHT('line4-ours'), theirs: EIGHT('line4-theirs') });
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await git.applyResolution(file, EIGHT('line4-merged'));
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-merged'));
    expect((await repo.git.status()).conflicted).toEqual([]);
  });
  it('refuses a fragment and leaves the file untouched', async () => {
    const repo = await conflictedRepo({ base: EIGHT('line4'), ours: EIGHT('line4-ours'), theirs: EIGHT('line4-theirs') });
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await expect(git.applyResolution(file, 'line4-merged')).rejects.toMatchObject({ reason: 'single line where both sides are multi-line' });
    expect(await repo.read('f.txt')).toBe(file.markedContent);
    expect((await repo.git.status()).conflicted).toEqual(['f.txt']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/gittyup && pnpm exec vitest run src/core/resolution-gate.test.ts src/core/git-operations.test.ts`
Expected: FAIL — `Cannot find module './resolution-gate.js'`; `applyResolution is not a function`.

- [ ] **Step 3: Implement** `checkResolution` as three ordered checks (markers, empty, single-line; "multi-line" means `split(/\r?\n/).filter(Boolean).length > 1`; a side counts as having content when it is a non-empty string). `applyResolution(file, content)`: `checkResolution` → throw `ResolutionRejected(file.path, reason)` on refusal; else `writeFileSync` + `git add`. Delete `resolveFile`.

- [ ] **Step 4: Run to verify they pass**

Run: same command. Expected: PASS, 18 tests across the two files.

- [ ] **Step 5: Commit**

```bash
git add apps/gittyup/src/core/resolution-gate.ts apps/gittyup/src/core/resolution-gate.test.ts apps/gittyup/src/core/git-operations.ts apps/gittyup/src/core/git-operations.test.ts
git commit -m "feat(gittyup): one gated write path for conflict resolutions"
```

---

### Task 3: AI text helpers and prompt builder

**Files:**
- Create: `apps/gittyup/src/core/ai-text.ts`
- Test: `apps/gittyup/src/core/ai-text.test.ts`

**Interfaces:**
- Consumes: `ConflictFile` (Task 1).
- Produces:

```ts
export function stripOuterFence(text: string): string;                 // removes exactly one ```lang … ``` wrapper around the whole trimmed text
export function extractLastFencedBlock(text: string): { rationale: string; code: string } | null;
export function diffStat(before: string, after: string): { added: number; removed: number }; // line multiset difference, approximate
export function buildAiMessages(file: ConflictFile, mode: 'auto' | 'suggest'): ChatCompletionMessage[];
```

`buildAiMessages` system copy (exact):
- auto: `You are a git merge conflict resolver. You receive the complete OURS, THEIRS and (when available) BASE versions of one file plus the conflicted working copy with markers. Output the complete merged file and nothing else: no explanation, no code fence.`
- suggest: `You are a git merge conflict resolver. You receive the complete OURS, THEIRS and (when available) BASE versions of one file plus the conflicted working copy with markers. Explain your resolution in at most five lines, then output the complete merged file in one fenced code block. The code block must be the last thing in your reply.`

User message sections in order: `File: <path>`, `=== OURS (complete file) ===`, `=== THEIRS (complete file) ===`, `=== BASE (complete file) ===` only when `base` is defined, `=== CONFLICTED WORKING COPY ===` with `markedContent`. A deleted side is rendered as `(deleted on this side)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/ai-text.test.ts
import { describe, expect, it } from 'vitest';
import { buildAiMessages, diffStat, extractLastFencedBlock, stripOuterFence } from './ai-text.js';

describe('stripOuterFence', () => {
  it('removes a bare fence', () => expect(stripOuterFence('```\na\nb\n```')).toBe('a\nb\n'));
  it('removes a fence with a language tag', () => expect(stripOuterFence('```ts\nconst a = 1;\n```\n')).toBe('const a = 1;\n'));
  it('leaves unfenced text alone', () => expect(stripOuterFence('a\nb\n')).toBe('a\nb\n'));
  it('does not strip an inner fence', () => {
    const t = 'intro\n```\ncode\n```\n';
    expect(stripOuterFence(t)).toBe(t);
  });
});

describe('extractLastFencedBlock', () => {
  it('returns the block and the text before it', () => {
    expect(extractLastFencedBlock('Reasoning here.\n\n```\nmerged\n```')).toEqual({ rationale: 'Reasoning here.', code: 'merged\n' });
  });
  it('takes the last of two blocks', () => {
    expect(extractLastFencedBlock('```\nfirst\n```\nthen\n```js\nsecond\n```')?.code).toBe('second\n');
  });
  it('returns null when there is no block', () => expect(extractLastFencedBlock('just prose')).toBeNull());
});

describe('diffStat', () => {
  it('counts added and removed lines', () => {
    expect(diffStat('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual({ added: 2, removed: 1 });
  });
});

describe('buildAiMessages', () => {
  const file = { path: 'f.txt', markedContent: 'm', ours: 'o\n', theirs: 't\n', base: 'b\n', hunks: [] };
  it('sends the complete files and the marked copy', () => {
    const [sys, user] = buildAiMessages(file, 'auto');
    expect(sys.role).toBe('system');
    expect(sys.content).toContain('Output the complete merged file and nothing else');
    expect(user.content).toContain('=== OURS (complete file) ===\no\n');
    expect(user.content).toContain('=== BASE (complete file) ===\nb\n');
    expect(user.content).toContain('=== CONFLICTED WORKING COPY ===\nm');
  });
  it('omits BASE when absent and marks a deleted side', () => {
    const [, user] = buildAiMessages({ ...file, base: undefined, theirs: undefined }, 'suggest');
    expect(user.content).not.toContain('=== BASE');
    expect(user.content).toContain('=== THEIRS (complete file) ===\n(deleted on this side)');
  });
  it('asks suggest mode for a final fenced block', () => {
    expect(buildAiMessages(file, 'suggest')[0].content).toContain('The code block must be the last thing in your reply.');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `Cannot find module './ai-text.js'`.

- [ ] **Step 3: Implement.** `stripOuterFence`: regex `^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$`; return group 1 with a trailing `\n` restored when the original inner text ended with one; otherwise return input unchanged. `extractLastFencedBlock`: global match of ```` ```[^\n]*\n([\s\S]*?)``` ````, take the last match; `rationale` = text before it, trimmed. `diffStat`: multiset of lines; `removed` = before lines not consumed by after, `added` = after lines not consumed by before. `buildAiMessages` per the copy above, `ChatCompletionMessage` imported from `../auth/types.js`.

- [ ] **Step 4: Run to verify they pass** — PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/gittyup/src/core/ai-text.ts apps/gittyup/src/core/ai-text.test.ts
git commit -m "feat(gittyup): AI prompt builder sends complete files; fence and block helpers"
```

---

### Task 4: Resolver flows through a prompt seam

**Files:**
- Create: `apps/gittyup/src/core/resolver-prompts.ts`
- Create: `apps/gittyup/src/test/scripted-prompts.ts`
- Modify: `apps/gittyup/src/core/conflict-resolver.ts` (whole file)
- Test: `apps/gittyup/src/core/conflict-resolver.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:

```ts
// src/core/resolver-prompts.ts
export interface ResolverPrompts {
  select<T>(opts: { message: string; choices: Array<{ name: string; value: T }> }): Promise<T>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
  editor(opts: { message: string; default: string }): Promise<string>;
}
export const inquirerPrompts: ResolverPrompts;   // thin adapter over @inquirer/prompts

// src/test/scripted-prompts.ts
export function scriptedPrompts(answers: unknown[]): ResolverPrompts & { calls: Array<{ kind: 'select' | 'confirm' | 'editor'; message: string }> };
// returns answers in order; throws `Error('no scripted answer for <kind>: <message>')` when exhausted

// src/core/conflict-resolver.ts
export interface ResolverOptions {
  prompts?: ResolverPrompts;          // default inquirerPrompts
  yes?: boolean;                      // skip the AI-auto write confirmation
  modelName?: string;                 // shown in menu copy; default 'AI'
  onAiResolve?: (file: ConflictFile, mode: 'auto' | 'suggest') => Promise<string | null>;
  onFileResolved?: (repoName: string, filePath: string) => void;
  onSessionComplete?: (session: ConflictSession) => void;
}
export class ConflictResolver {
  constructor(git: GitOperations, repo: RepoConfig, aiMode: AiMode, options?: ResolverOptions);
  startSession(operation, sourceBranch, targetBranch): Promise<ConflictSession>; // unchanged signature
}
```

Menu values (unchanged strings, tests select by value): `'ai-auto' | 'ai-suggest' | 'ours' | 'theirs' | 'manual' | 'view-full' | 'skip'`. Menu names: `🤖 AI auto-resolve (<model> writes the merged file)`, `💡 AI suggest (<model> proposes, you approve)`, the rest as today. When `file.hunks.length === 0`, only `ours`, `theirs`, `skip` are offered.

Flows:
- **manual**: `editor({ default: file.markedContent })` → `applyResolution`; on `ResolutionRejected` print `  ✗ <reason>` then `confirm({ message: 'Reopen the editor?', default: true })` → yes: reopen with the rejected content as default; no: return false.
- **ai-auto**: `onAiResolve(file,'auto')` → null → print fallback, back to menu. Else `stripOuterFence` → `applyResolution` inside try; on `ResolutionRejected` print reason, back to menu. Before writing, print `  AI resolution: +<added> −<removed> lines vs OURS` and, unless `options.yes`, `confirm({ message: 'Write this resolution to <path>?', default: true })`; no → back to menu.
- **ai-suggest**: reply → `extractLastFencedBlock` → null → print `AI did not return a usable suggestion.` → menu. Else print rationale and code, then `select` accept/edit/reject as today; accept → `applyResolution` (rejection → reason, menu); edit → manual flow with `code` as the editor default.
- **ours/theirs/skip/view-full**: as today (view-full prints `markedContent`).
- `showConflictPreview` prints each hunk as `─── hunk i/N ───` with up to 8 lines per side.

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/conflict-resolver.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, makeRepo } from '../test/git-fixture.js';
import { scriptedPrompts } from '../test/scripted-prompts.js';
import { ConflictResolver } from './conflict-resolver.js';
import { GitOperations } from './git-operations.js';

afterEach(() => cleanupFixtures());
const EIGHT = (l4: string) => `line1\nline2\nline3\n${l4}\nline5\nline6\nline7\nline8\n`;
const repoCfg = { name: 'r', path: '.', remote: 'origin', branches: {}, tags: [] };

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
      onAiResolve: async () => '```\n' + EIGHT('line4-merged') + '```',
    });
    const session = await resolver.startSession('merge', 'main', 'develop');
    expect(session.status).toBe('resolved');
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-merged'));
  });

  it('AI auto returning a fragment is refused and falls back to the menu', async () => {
    const { repo, git } = await conflicted();
    const prompts = scriptedPrompts(['ai-auto', 'ours', true]);
    const resolver = new ConflictResolver(git, repoCfg, 'auto', { prompts, onAiResolve: async () => 'line4-merged' });
    const session = await resolver.startSession('merge', 'main', 'develop');
    expect(session.status).toBe('resolved');
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-ours'));
  });

  it('AI suggest accepts only the last fenced block', async () => {
    const { repo, git } = await conflicted();
    const prompts = scriptedPrompts(['ai-suggest', 'accept', true]);
    const resolver = new ConflictResolver(git, repoCfg, 'suggest', {
      prompts,
      onAiResolve: async () => 'I kept both.\n\n```\n' + EIGHT('line4-both') + '```',
    });
    await resolver.startSession('merge', 'main', 'develop');
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-both'));
  });

  it('manual edit opens the marked file and writes the edited whole file', async () => {
    const { repo, git } = await conflicted();
    const prompts = scriptedPrompts(['manual', EIGHT('line4-manual'), true]);
    const resolver = new ConflictResolver(git, repoCfg, 'manual', { prompts });
    await resolver.startSession('merge', 'main', 'develop');
    expect(prompts.calls.find((c) => c.kind === 'editor')).toBeDefined();
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
    const resolver = new ConflictResolver(new GitOperations(repo.path), repoCfg, 'auto', { prompts });
    await resolver.startSession('merge', 'main', 'develop');
    const menu = prompts.calls.find((c) => c.kind === 'select');
    expect(menu).toBeDefined();
    expect(await repo.read('f.txt')).toBe('x-main\n');
  });

  it('with yes: true, AI auto writes without a confirmation prompt', async () => {
    const { git } = await conflicted();
    const prompts = scriptedPrompts(['ai-auto', true]); // menu, commit?
    const resolver = new ConflictResolver(git, repoCfg, 'auto', { prompts, yes: true, onAiResolve: async () => EIGHT('m') });
    const session = await resolver.startSession('merge', 'main', 'develop');
    expect(session.status).toBe('resolved');
    expect(prompts.calls.filter((c) => c.kind === 'confirm').map((c) => c.message)).toEqual(['Commit the resolution?']);
  });
});
```

For the "no hunks" case the scripted `select` must also expose the offered choices: extend `calls` entries with `choices?: string[]` (the `value`s) and assert `expect(menu?.choices).toEqual(['ours', 'theirs', 'skip'])`.

- [ ] **Step 2: Run to verify they fail** — `Cannot find module '../test/scripted-prompts.js'`.

- [ ] **Step 3: Implement** `resolver-prompts.ts`, `scripted-prompts.ts`, and rewrite `conflict-resolver.ts` per the flows above. Keep `startSession`'s post-loop handling (resolved → commit confirm; else retry/abort/leave/escalate select) unchanged except that it goes through `this.prompts`.

- [ ] **Step 4: Run to verify they pass** — `pnpm exec vitest run src/core/conflict-resolver.test.ts` → PASS, 7 tests. `pnpm typecheck` → errors remain only in `orchestrator.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/gittyup/src/core/resolver-prompts.ts apps/gittyup/src/test/scripted-prompts.ts apps/gittyup/src/core/conflict-resolver.ts apps/gittyup/src/core/conflict-resolver.test.ts
git commit -m "feat(gittyup): resolver writes whole files through the gate; prompt seam for tests"
```

---

### Task 5: Orchestrator, `ai_model`, `--yes`, docs, changeset

**Files:**
- Modify: `apps/gittyup/src/core/orchestrator.ts:276-340` (`createAiResolver`; resolver construction at lines ~84 and ~175)
- Modify: `apps/gittyup/src/config/schema.ts:53-58` (`ai_model: z.string().optional()`)
- Modify: `apps/gittyup/src/commands/merge.ts`, `apps/gittyup/src/commands/pick.ts` (`-y, --yes`)
- Modify: `apps/gittyup/src/commands/config.ts` (`--model <id>` sets `ai_model`; `--show` prints it)
- Modify: `apps/gittyup/README.md` (Conflict Resolution + AI Modes sections), `apps/gittyup/gittyup.example.yaml` (`ai_model`), `docs/superpowers/specs/2026-10-19-gittyup-hardening-design.md` §7 (e2e bullet)
- Create: `.changeset/gittyup-whole-file-resolution.md`
- Test: `apps/gittyup/src/config/schema.test.ts` (add one case)

**Interfaces:**
- Consumes: `buildAiMessages`, `ResolverOptions`.
- Produces: `Orchestrator.executeMerge/executeCherryPick` options gain `yes?: boolean`.

- [ ] **Step 1: Write the failing schema test**

```ts
it('accepts an optional ai_model', () => {
  const r = ManifestSettingsSchema.safeParse({ ai_model: 'claude-sonnet-4' });
  expect(r.success && r.data.ai_model).toBe('claude-sonnet-4');
  expect(ManifestSettingsSchema.parse({}).ai_model).toBeUndefined();
});
```

Run: `pnpm exec vitest run src/config/schema.test.ts` → FAIL (`ai_model` stripped / undefined on parse of the first object).

- [ ] **Step 2: Implement**

- `schema.ts`: `ai_model: z.string().optional()`.
- `orchestrator.ts`: `createAiResolver()` uses `buildAiMessages(file, mode)` and `this.manifest.data.settings.ai_model ?? 'gpt-4o'`; no fence stripping here (the resolver does it). Resolver construction passes `{ onAiResolve, yes: options.yes, modelName: <model> }`.
- `merge.ts`, `pick.ts`: `.option('-y, --yes', 'Skip the AI write confirmation', false)`; pass `yes: opts.yes`.
- `config.ts`: `--model <id>` → `updateSettings({ ai_model })`; `--show` prints `AI Model:` line.
- README: replace the AI Modes table rows with "AI auto: the model writes the complete merged file; you see a line diff and confirm (skip with `--yes`)", "AI suggest: the model explains, then proposes the complete file in a code block; accept, edit or reject", "manual: your editor opens the conflicted file with markers; a resolution that still has markers is refused and the editor reopens". Add `ai_model` to the settings example. Remove the word "Claude" from this section.
- Spec §7: replace "`merge --no-fetch` on a two-repo fixture driven by stdin answers" with "resolver flows via the `ResolverPrompts` seam with scripted answers (stdin-driven prompts are not viable: inquirer drops keystrokes after the first prompt once stdin is at EOF, verified 2026-10-19)".
- Changeset `minor`: "Conflict resolution writes whole files only: full OURS/THEIRS/BASE from the index, one gated write path that refuses markers, fragments and prose; manual edit opens the marked file; AI auto confirms with a line diff (`--yes` to skip); AI suggest takes the last fenced block; new `settings.ai_model` (`config --model`)."

- [ ] **Step 3: Verify**

Run, from `apps/gittyup`: `pnpm typecheck && pnpm test && pnpm test:e2e && (cd ../.. && pnpm exec biome check apps/gittyup)`
Expected: all exit 0; unit count = 17 (prior) + 8 + 10 + 11 + 7 + 1 = 54; e2e 6.

- [ ] **Step 4: Manual check once** (ledger the result): in a scratch repo with one conflict, `gittyup merge main develop -r <repo> --no-fetch --ai manual`, choose Manual edit, save the file unchanged, see the refusal and the reopen prompt.

- [ ] **Step 5: Commit**

```bash
git add apps/gittyup .changeset/gittyup-whole-file-resolution.md docs/superpowers/specs/2026-10-19-gittyup-hardening-design.md
git commit -m "feat(gittyup): AI prompts send complete files; ai_model setting; --yes; docs"
```

---

## Self-review notes

- Spec §3.1 coverage: model (T1), stage reads (T1), gate + single write (T2), preview per hunk and view-full (T4), manual edit from marked content with reopen (T4), AI auto full files + strip one fence + gate + diff line + confirm/`--yes` (T3, T4, T5), AI suggest last block (T3, T4), `ai_model` (T5), delete/modify handling (T1), the five listed tests (T1, T2, T3).
- Spec §3.1's "Tests" bullet names `conflict-resolver.test.ts`; T4 provides it through the prompt seam, which the spec did not foresee; T5 amends §7 accordingly.
- Type consistency: `ConflictFile.hunks: ConflictHunk[]` (T1) is what T4's "no hunks" check reads; `ResolutionRejected.reason` (T2) is what T4 prints; `applyResolution(file, content)` takes the file, not the path, so the gate has `ours`/`theirs`.
- Out of scope and untouched: stash/branch restore, cherry-pick resume, escalation, PRs (slices 3.2–3.5).
