import { describe, it, expect } from 'vitest';
import type { TaskNode, StateDefinition } from '../../src/config/schema.js';
import { STANDARD_PRESET } from '../../src/config/state-presets.js';
import { executeSetStatus } from '../../src/commands/set-status.js';
import { executeQAFail, executeQAFailBatch } from '../../src/commands/qa-fail.js';
import { executeQAClear, executeQAClearBatch } from '../../src/commands/qa-clear.js';
import {
  buildDelegationManifest,
  findNextTask,
} from '../../src/readiness/index.js';

const STATES: StateDefinition[] = [...STANDARD_PRESET];

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: '1',
    title: 'Test task',
    description: '',
    type: 'task',
    status: 'todo',
    complexity: 1,
    priority: 'medium',
    requiredSkills: [],
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: [],
    qaFeedback: [],
    children: [],
    metadata: {
      source: '',
      autoExpanded: false,
      skillsInferred: false,
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe('QA Feedback Loop — Full Cycle', () => {
  it('qa-fail → dependent tagged + pulled back → fix → qa-clear → done', () => {
    // Setup: T-1 is done, T-2 depends on T-1 and is also done
    const tasks = [
      makeTask({ id: 'T-1', status: 'done', priority: 'high', requiredSkills: ['backend'] }),
      makeTask({
        id: 'T-2',
        status: 'done',
        priority: 'medium',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];

    // Step 1: QA fails T-1
    const qaResult = executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'component',
      description: 'Config loader fails on empty YAML',
      cause: 'Missing null check',
      severity: 'major',
    });

    // Verify: T-1 is qa-failed with feedback
    expect(qaResult.task.status).toBe('qa-failed');
    expect(qaResult.task.qaFeedback).toHaveLength(1);
    expect(qaResult.task.tags).toContain('qa-failed-source');

    // Verify: T-2 was pulled back and tagged
    expect(qaResult.pulledBackDependents).toContain('T-2');
    expect(tasks[1].status).toBe('review'); // pulled back from done
    expect(tasks[1].tags).toContain('qa-review-needed');

    // Step 2: Check delegation manifest
    const manifest = buildDelegationManifest(tasks, STATES);
    expect(manifest.qa_failed_tasks).toHaveLength(1);
    expect(manifest.qa_failed_tasks[0].id).toBe('T-1');

    // Step 3: findNextTask should return T-1 (qa-failed with boost)
    const next = findNextTask(tasks, STATES);
    expect(next?.id).toBe('T-1');

    // Step 4: Verify the gate — T-2 cannot go to done while tagged
    expect(() =>
      executeSetStatus(tasks, 'T-2', 'done', STATES, false),
    ).toThrow('qa-review-needed');

    // Step 5: Dev fixes T-1 (move to in-progress, then done)
    executeSetStatus(tasks, 'T-1', 'in-progress', STATES, false, { force: true });
    expect(tasks[0].status).toBe('in-progress');

    executeSetStatus(tasks, 'T-1', 'done', STATES, false, { force: true });
    expect(tasks[0].status).toBe('done');

    // Step 6: Dev reviews T-2 impact, reruns tests, clears the tag
    const clearResult = executeQAClear(tasks, 'T-2', STATES, {
      reporter: 'dev-agent',
      note: 'Reviewed, tests pass after fix',
    });

    expect(clearResult.tagRemoved).toBe(true);
    expect(tasks[1].tags).not.toContain('qa-review-needed');
    expect(clearResult.task.qaFeedback).toHaveLength(1);
    expect(clearResult.task.qaFeedback[0].result).toBe('pass');

    // Step 7: T-2 can now go to done
    const finalResult = executeSetStatus(tasks, 'T-2', 'done', STATES, false);
    expect(finalResult.task.status).toBe('done');
  });

  it('cascading qa-fail blocks the entire chain', () => {
    // T-1 → T-2 → T-3 (chain of dependencies)
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'done',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
      makeTask({
        id: 'T-3',
        status: 'todo',
        dependencies: [{ taskId: 'T-2', type: 'blocks' }],
      }),
    ];

    // QA fails T-1
    executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'integration',
      description: 'API contract broken',
    });

    // T-1 is qa-failed
    expect(tasks[0].status).toBe('qa-failed');

    // T-2 was pulled back from done → review (non-closed)
    expect(tasks[1].status).toBe('review');

    // T-3 should now be blocked because T-2 is no longer closed
    expect(tasks[2].readiness).toBe('blocked');
  });

  it('multiple QA failure cycles accumulate feedback entries', () => {
    const tasks = [makeTask({ id: 'T-1', status: 'done' })];

    // First failure
    executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'unit',
      description: 'First failure',
      severity: 'minor',
    });
    expect(tasks[0].qaFeedback).toHaveLength(1);

    // Dev fixes and sets back to done
    executeSetStatus(tasks, 'T-1', 'in-progress', STATES, false, { force: true });
    executeSetStatus(tasks, 'T-1', 'done', STATES, false, { force: true });

    // Second failure
    executeQAFail(tasks, 'T-1', STATES, false, {
      testType: 'integration',
      description: 'Second failure',
      severity: 'critical',
    });
    expect(tasks[0].qaFeedback).toHaveLength(2);
    expect(tasks[0].qaFeedback[0].description).toBe('First failure');
    expect(tasks[0].qaFeedback[1].description).toBe('Second failure');
  });

  it('qa-clear records pass and allows task to proceed', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'review',
        tags: ['qa-review-needed'],
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];

    // Clear the review tag
    const clearResult = executeQAClear(tasks, 'T-2', STATES, {
      note: 'All tests pass',
    });

    expect(clearResult.tagRemoved).toBe(true);
    expect(clearResult.feedbackEntry.result).toBe('pass');

    // T-2 can now transition to done
    const statusResult = executeSetStatus(tasks, 'T-2', 'done', STATES, false);
    expect(statusResult.task.status).toBe('done');
  });
});

describe('QA Feedback Loop — Batch Cycle', () => {
  it('batch qa-fail → verify dependents → batch qa-clear → all proceed to done', () => {
    // Setup: T-1, T-2 are done; T-3 depends on both, T-4 depends on T-1 only
    const tasks = [
      makeTask({ id: 'T-1', status: 'done', priority: 'high' }),
      makeTask({ id: 'T-2', status: 'done', priority: 'high' }),
      makeTask({
        id: 'T-3',
        status: 'done',
        dependencies: [
          { taskId: 'T-1', type: 'blocks' },
          { taskId: 'T-2', type: 'blocks' },
        ],
      }),
      makeTask({
        id: 'T-4',
        status: 'done',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];

    // Step 1: Batch qa-fail T-1 and T-2
    const failResult = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'Config fails', severity: 'major' },
        { taskId: 'T-2', testType: 'integration', description: 'API broken', severity: 'critical' },
      ],
      STATES,
      false,
    );

    expect(failResult.entries).toHaveLength(2);
    expect(failResult.errors).toHaveLength(0);
    expect(tasks[0].status).toBe('qa-failed');
    expect(tasks[1].status).toBe('qa-failed');

    // T-3 depends on both — tagged once, pulled back once
    expect(tasks[2].tags.filter((t) => t === 'qa-review-needed')).toHaveLength(1);
    expect(tasks[2].status).toBe('review'); // pulled back from done

    // T-4 depends on T-1 only — also tagged and pulled back
    expect(tasks[3].tags).toContain('qa-review-needed');
    expect(tasks[3].status).toBe('review');

    // Deduplication check
    expect(failResult.summary.dependentsTagged).toBe(2); // T-3 and T-4
    expect(failResult.summary.dependentsPulledBack).toBe(2);

    // Step 2: Check delegation manifest shows qa-failed tasks
    const manifest = buildDelegationManifest(tasks, STATES);
    expect(manifest.qa_failed_tasks).toHaveLength(2);

    // Step 3: The gate — dependents can't go to done while tagged
    expect(() =>
      executeSetStatus(tasks, 'T-3', 'done', STATES, false),
    ).toThrow('qa-review-needed');

    // Step 4: Dev fixes T-1 and T-2
    executeSetStatus(tasks, 'T-1', 'in-progress', STATES, false, { force: true });
    executeSetStatus(tasks, 'T-1', 'done', STATES, false, { force: true });
    executeSetStatus(tasks, 'T-2', 'in-progress', STATES, false, { force: true });
    executeSetStatus(tasks, 'T-2', 'done', STATES, false, { force: true });

    // Step 5: Batch qa-clear the dependents
    const clearResult = executeQAClearBatch(
      tasks,
      [
        { taskId: 'T-3', reporter: 'dev-agent', note: 'Impact reviewed, tests pass' },
        { taskId: 'T-4', reporter: 'dev-agent', note: 'Retested, all green' },
      ],
      STATES,
    );

    expect(clearResult.entries).toHaveLength(2);
    expect(clearResult.errors).toHaveLength(0);
    expect(tasks[2].tags).not.toContain('qa-review-needed');
    expect(tasks[3].tags).not.toContain('qa-review-needed');

    // Both got pass feedback
    expect(tasks[2].qaFeedback).toHaveLength(1);
    expect(tasks[2].qaFeedback[0].result).toBe('pass');
    expect(tasks[3].qaFeedback).toHaveLength(1);

    // Step 6: Dependents can now proceed to done
    const t3Done = executeSetStatus(tasks, 'T-3', 'done', STATES, false);
    expect(t3Done.task.status).toBe('done');
    const t4Done = executeSetStatus(tasks, 'T-4', 'done', STATES, false);
    expect(t4Done.task.status).toBe('done');
  });

  it('batch with partial errors still processes valid entries', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({
        id: 'T-2',
        status: 'done',
        dependencies: [{ taskId: 'T-1', type: 'blocks' }],
      }),
    ];

    const result = executeQAFailBatch(
      tasks,
      [
        { taskId: 'T-1', testType: 'unit', description: 'Valid failure' },
        { taskId: 'T-GHOST', testType: 'unit', description: 'Ghost task' },
      ],
      STATES,
      false,
    );

    // T-1 still processed
    expect(result.entries).toHaveLength(1);
    expect(tasks[0].status).toBe('qa-failed');
    // T-2 was tagged as dependent of T-1
    expect(tasks[1].tags).toContain('qa-review-needed');
    // Ghost reported as error
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe('T-GHOST');
  });
});
