import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRaw = vi.fn();
vi.mock('simple-git', () => {
  const factory = vi.fn(() => ({ raw: mockRaw }));
  return { default: factory, simpleGit: factory };
});

const { isAncestor, resolveHead } = await import('../collector/refs.js');

describe('refs (#79)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('resolveHead returns the 40-hex SHA of HEAD, resolved behind --end-of-options', async () => {
    mockRaw.mockResolvedValueOnce('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
    expect(await resolveHead('/r')).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(mockRaw.mock.calls[0][0]).toEqual([
      'rev-parse',
      '--verify',
      '--end-of-options',
      'HEAD^{commit}',
    ]);
  });

  it('resolveHead returns null for an empty repo or garbage output', async () => {
    mockRaw.mockRejectedValueOnce(new Error('fatal: Needed a single revision'));
    expect(await resolveHead('/r')).toBeNull();
    mockRaw.mockResolvedValueOnce('not-a-sha\n');
    expect(await resolveHead('/r')).toBeNull();
  });

  it('isAncestor is true when merge-base exits 0 and false when it exits non-zero', async () => {
    mockRaw.mockResolvedValueOnce('');
    expect(
      await isAncestor(
        '/r',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ),
    ).toBe(true);
    expect(mockRaw.mock.calls[0][0]).toEqual([
      'merge-base',
      '--is-ancestor',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]);
    mockRaw.mockRejectedValueOnce(new Error('exit 1'));
    expect(
      await isAncestor(
        '/r',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ),
    ).toBe(false);
  });

  it('isAncestor refuses anything that is not a SHA without calling git', async () => {
    expect(
      await isAncestor('/r', '--output=/tmp/x', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    ).toBe(false);
    expect(mockRaw).not.toHaveBeenCalled();
  });
});
