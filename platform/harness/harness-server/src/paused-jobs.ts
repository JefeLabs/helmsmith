/**
 * Paused-job persistence — the JobRecord half of HITL restart survival
 * (roadmap 2.2). The graph's paused thread state lives in the durable
 * checkpointer (SQLite); this module persists the matching JobRecord +
 * pending Approval/Suspend request as one JSON file per job under
 * `<stateDir>/paused/<jobId>.json`, written when a job pauses and
 * deleted when it resumes or reaches a terminal state. At boot the
 * server rehydrates these into its in-memory maps; the compiled graph
 * itself is NOT persisted — resumeJob recompiles it from `job.flow`
 * against the durable checkpointer (recompile-on-resume).
 *
 * Persistence is best-effort by design: a failed write must never fail
 * the pause itself (callers fire-and-forget with a console.warn), and
 * an unparseable file at boot is skipped loudly rather than aborting
 * startup.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApprovalRequest, JobRecord, SuspendRequest } from '@helmsmith/harness-core';

export interface PausedJobFile {
  /** The full JobRecord — plain data, including the FlowDef needed for
   *  recompile-on-resume. */
  job: JobRecord;
  kind: 'approval' | 'suspend';
  request: ApprovalRequest | SuspendRequest;
  /** ISO timestamp of the pause — SLA re-arm math reads this at boot. */
  pausedAt: string;
}

const SUBDIR = 'paused';

function fileFor(stateDir: string, jobId: string): string {
  return join(stateDir, SUBDIR, `${encodeURIComponent(jobId)}.json`);
}

export async function savePausedJob(stateDir: string, file: PausedJobFile): Promise<void> {
  await mkdir(join(stateDir, SUBDIR), { recursive: true });
  await writeFile(fileFor(stateDir, file.job.jobId), JSON.stringify(file, null, 2), 'utf8');
}

export async function deletePausedJob(stateDir: string, jobId: string): Promise<void> {
  await rm(fileFor(stateDir, jobId), { force: true });
}

export async function loadPausedJobs(stateDir: string): Promise<PausedJobFile[]> {
  let names: string[];
  try {
    names = await readdir(join(stateDir, SUBDIR));
  } catch {
    return [];
  }
  const out: PausedJobFile[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(
        await readFile(join(stateDir, SUBDIR, name), 'utf8'),
      ) as PausedJobFile;
      if (parsed && typeof parsed === 'object' && parsed.job?.jobId) {
        out.push(parsed);
      } else {
        console.warn(`[paused-jobs] skipping ${name}: not a PausedJobFile`);
      }
    } catch (err) {
      console.warn(`[paused-jobs] skipping unparseable ${name}: ${(err as Error).message}`);
    }
  }
  return out;
}
