/**
 * Conflict resolution with no person present (spec §5.3), for `merge`/`pick --json`.
 *
 * Sits beside `ConflictResolver`, not inside it: that class's fallbacks are menus. Here
 * the agent tries each conflicted file in order; the first file it can't resolve stops
 * the walk, because the caller rolls the whole repo back anyway and every further agent
 * call would be wasted spend.
 */
import type { ConflictFile } from '../config/schema.js';
import type { ConflictRow } from '../output/contract.js';
import { stripOuterFence } from './ai-text.js';
import type { AgentReply } from './copilot-agent.js';
import type { GitOperations } from './git-operations.js';
import { ResolutionRejected } from './resolution-gate.js';

export interface HeadlessAgent {
  /** `manual` never calls the agent. */
  mode: 'auto' | 'manual';
  /** `null` when the agent is unavailable for this run. */
  reply: AgentReply | null;
  /** Why `reply` is null; reported on every file. */
  unavailableReason?: string;
}

const isBinary = (f: ConflictFile) => [f.ours, f.theirs, f.base].some((s) => s?.includes('\0'));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function resolveConflictsHeadless(
  git: GitOperations,
  agent: HeadlessAgent,
  commit?: string,
): Promise<{ resolved: boolean; conflicts: ConflictRow[] }> {
  const files = await git.getConflictedFiles();
  const row = (path: string, outcome: ConflictRow['outcome'], reason?: string): ConflictRow => ({
    path,
    ...(commit ? { commit } : {}),
    outcome,
    ...(reason !== undefined ? { reason } : {}),
  });

  if (agent.mode === 'manual') {
    return {
      resolved: false,
      conflicts: files.map((f) => row(f.path, 'not_attempted', 'ai mode is manual')),
    };
  }
  const reply = agent.reply;
  if (!reply) {
    return {
      resolved: false,
      conflicts: files.map((f) => row(f.path, 'agent_unavailable', agent.unavailableReason)),
    };
  }

  const conflicts: ConflictRow[] = [];
  for (const file of files) {
    if (conflicts.some((c) => c.outcome !== 'resolved')) {
      conflicts.push(
        row(file.path, 'not_attempted', 'an earlier file in this repo was not resolved'),
      );
      continue;
    }
    conflicts.push(await resolveOne(git, file, reply, row));
  }

  const resolved =
    conflicts.length > 0 &&
    conflicts.every((c) => c.outcome === 'resolved') &&
    (await git.getStatus()).conflicted.length === 0;
  return { resolved, conflicts };
}

async function resolveOne(
  git: GitOperations,
  file: ConflictFile,
  reply: AgentReply,
  row: (path: string, outcome: ConflictRow['outcome'], reason?: string) => ConflictRow,
): Promise<ConflictRow> {
  if (isBinary(file)) return row(file.path, 'agent_refused', 'binary file');
  let text: string;
  try {
    text = await reply(file);
  } catch (err) {
    return row(file.path, 'agent_error', message(err));
  }
  const content = stripOuterFence(text);
  if (content.trim() === '') return row(file.path, 'agent_refused', 'empty reply');
  try {
    await git.applyResolution(file, content);
  } catch (err) {
    if (err instanceof ResolutionRejected) return row(file.path, 'agent_refused', err.reason);
    return row(file.path, 'agent_error', message(err));
  }
  return row(file.path, 'resolved');
}
