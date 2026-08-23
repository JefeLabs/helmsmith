import { describe, expect, it } from 'vitest';
import { recordTotalLines } from '../aggregator/metrics.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

function ft(insertions: number, deletions: number) {
  return { files: 1, filesAdded: 0, filesDeleted: 0, insertions, deletions };
}

describe('recordTotalLines', () => {
  it('sums all five filetypes including doc', () => {
    const rec: Pick<UserWeekRepoRecord, 'filetype'> = {
      filetype: {
        app: ft(10, 2),
        test: ft(5, 0),
        config: ft(1, 1),
        storybook: ft(0, 0),
        doc: ft(7, 3),
      },
    };

    // app 12 + test 5 + config 2 + storybook 0 + doc 10 = 29
    expect(recordTotalLines(rec)).toBe(29);
  });

  it('treats a missing doc filetype as zero', () => {
    // `doc` is required in the inferred UserWeekRepoRecord type (zod fills it
    // via .default() on parse), but records built outside a zod .parse() call
    // — as happens in some test fixtures and older data — may omit it.
    const rec = {
      filetype: {
        app: ft(10, 0),
        test: ft(0, 0),
        config: ft(0, 0),
        storybook: ft(0, 0),
      },
    } as unknown as Pick<UserWeekRepoRecord, 'filetype'>;

    expect(recordTotalLines(rec)).toBe(10);
  });
});
