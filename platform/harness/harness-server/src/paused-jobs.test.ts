import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalRequest, JobRecord } from '@helmsmith/harness-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deletePausedJob,
  loadPausedJobs,
  type PausedJobFile,
  savePausedJob,
} from './paused-jobs.ts';

describe('paused-jobs persistence', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'paused-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const job: JobRecord = {
    jobId: 'j1',
    status: 'awaiting-approval',
    submittedAt: 'now',
    agents: [],
  };
  const request: ApprovalRequest = {
    kind: 'approval',
    nodeId: 'n',
    assigneeRole: 'lead',
    slaMs: 1000,
    content: 'c',
    attempt: 1,
    changes: [],
  };
  const record: PausedJobFile = {
    kind: 'approval',
    pausedAt: '2026-08-12T00:00:00.000Z',
    job,
    request,
  };

  it('round-trips a paused job through save + load', async () => {
    await savePausedJob(dir, record);
    expect(await loadPausedJobs(dir)).toEqual([record]);
  });

  it('load returns [] when the state directory does not exist', async () => {
    expect(await loadPausedJobs(join(dir, 'nope'))).toEqual([]);
  });

  it('delete removes the file and tolerates already-missing files', async () => {
    await savePausedJob(dir, record);
    await deletePausedJob(dir, 'j1');
    expect(await loadPausedJobs(dir)).toEqual([]);
    await expect(deletePausedJob(dir, 'j1')).resolves.toBeUndefined();
  });

  it('load skips unparseable files and keeps the good ones', async () => {
    await savePausedJob(dir, record);
    await writeFile(join(dir, 'paused', 'bad.json'), '{nope', 'utf8');
    expect(await loadPausedJobs(dir)).toEqual([record]);
  });
});
