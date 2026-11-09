import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommitMessage } from '../../ai.js';

/**
 * The commit plan a run showed, kept so the next run commits exactly that
 * text instead of asking the model again. A dry run is what people review;
 * a real run that re-drafted would commit words nobody read.
 */
export interface PlanCache {
  read(key: string): Promise<CommitMessage[] | undefined>;
  write(key: string, plan: readonly CommitMessage[]): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Everything the plan depends on. `stagedState` is HEAD plus the index's tree
 * (`git write-tree`), so a staged edit, a commit made elsewhere or a reset
 * each miss; the rest covers how the plan was categorised and typed.
 */
export function planKey(parts: {
  stagedState: string;
  branch: string;
  commitStyle: string;
  categories: Record<string, string[]>;
  version: string;
}): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function isCommitMessage(v: unknown): v is CommitMessage {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.category === 'string' &&
    typeof c.message === 'string' &&
    (c.body === undefined || typeof c.body === 'string') &&
    Array.isArray(c.files) &&
    c.files.every((f) => typeof f === 'string')
  );
}

/**
 * One plan per worktree, in a file under its git directory, so it is never
 * tracked and each worktree (each index) has its own. Anything unreadable is a
 * miss: the cost of a miss is one more model call.
 */
export function filePlanCache(path: () => Promise<string>): PlanCache {
  return {
    async read(key) {
      try {
        const saved = JSON.parse(readFileSync(await path(), 'utf8')) as {
          key?: unknown;
          plan?: unknown;
        };
        if (saved.key !== key || !Array.isArray(saved.plan)) return undefined;
        return saved.plan.every(isCommitMessage) ? saved.plan : undefined;
      } catch {
        return undefined;
      }
    },
    async write(key, plan) {
      const file = await path();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ key, plan }, null, 2)}\n`);
    },
    async clear() {
      rmSync(await path(), { force: true });
    },
  };
}
