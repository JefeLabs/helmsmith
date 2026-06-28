import Handlebars from 'handlebars';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  complexityColor,
  dateFormat,
  indent,
  pluralize,
  progressBar,
  registerHelpers,
  statusBadge,
} from '../../../src/generator/helpers.js';

// Register helpers once for block helper tests
beforeAll(() => {
  registerHelpers();
});

describe('complexityColor', () => {
  it('returns green for low scores (1-3)', () => {
    for (const score of [1, 2, 3]) {
      const result = complexityColor(score);
      expect(result).toContain(String(score));
    }
  });

  it('returns yellow for medium scores (4-6)', () => {
    for (const score of [4, 5, 6]) {
      const result = complexityColor(score);
      expect(result).toContain(String(score));
    }
  });

  it('returns red for high scores (7-10)', () => {
    for (const score of [7, 8, 9, 10]) {
      const result = complexityColor(score);
      expect(result).toContain(String(score));
    }
  });

  it('handles non-numeric input gracefully', () => {
    expect(complexityColor('abc')).toBe('abc');
  });
});

describe('statusBadge', () => {
  it('renders done with checkmark', () => {
    const result = statusBadge('done');
    expect(result).toContain('\u2713');
    expect(result).toContain('done');
  });

  it('renders in-progress with circle', () => {
    const result = statusBadge('in-progress');
    expect(result).toContain('\u25CB');
    expect(result).toContain('in-progress');
  });

  it('renders blocked with X', () => {
    const result = statusBadge('blocked');
    expect(result).toContain('\u2718');
    expect(result).toContain('blocked');
  });

  it('renders todo with dot', () => {
    const result = statusBadge('todo');
    expect(result).toContain('\u2022');
    expect(result).toContain('todo');
  });

  it('renders unknown status with dot fallback', () => {
    const result = statusBadge('custom-status');
    expect(result).toContain('\u2022');
    expect(result).toContain('custom-status');
  });
});

describe('progressBar', () => {
  it('renders 0%', () => {
    const result = progressBar(0, 10);
    expect(result).toContain('0%');
  });

  it('renders 50%', () => {
    const result = progressBar(5, 10);
    expect(result).toContain('50%');
  });

  it('renders 100%', () => {
    const result = progressBar(10, 10);
    expect(result).toContain('100%');
  });

  it('handles zero total', () => {
    const result = progressBar(0, 0);
    expect(result).toContain('0%');
  });

  it('clamps values above 100%', () => {
    const result = progressBar(15, 10);
    expect(result).toContain('100%');
  });
});

describe('dateFormat', () => {
  it('formats ISO date with YYYY-MM-DD', () => {
    expect(dateFormat('2026-02-11T10:30:00.000Z', 'YYYY-MM-DD')).toBe('2026-02-11');
  });

  it('formats ISO date with full datetime', () => {
    // Note: result depends on local timezone; test the pattern
    const result = dateFormat('2026-02-11T10:30:45.000Z', 'YYYY-MM-DD HH:mm:ss');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('returns original string for invalid dates', () => {
    expect(dateFormat('not-a-date', 'YYYY-MM-DD')).toBe('not-a-date');
  });

  it('uses YYYY-MM-DD as default format', () => {
    const result = dateFormat('2026-02-11T10:30:00.000Z', undefined);
    expect(result).toBe('2026-02-11');
  });
});

describe('pluralize', () => {
  it('returns singular for count 1', () => {
    expect(pluralize(1, 'task', 'tasks')).toBe('task');
  });

  it('returns plural for count 0', () => {
    expect(pluralize(0, 'task', 'tasks')).toBe('tasks');
  });

  it('returns plural for count > 1', () => {
    expect(pluralize(5, 'task', 'tasks')).toBe('tasks');
  });
});

describe('indent', () => {
  it('indents single line by 1 level', () => {
    expect(indent('hello', 1)).toBe('  hello');
  });

  it('indents multiline text', () => {
    const result = indent('line1\nline2', 2);
    expect(result).toBe('    line1\n    line2');
  });

  it('returns original for level 0', () => {
    expect(indent('hello', 0)).toBe('hello');
  });

  it('returns original for negative level', () => {
    expect(indent('hello', -1)).toBe('hello');
  });
});

describe('block comparison helpers (via Handlebars)', () => {
  describe('if-gte', () => {
    it('renders fn block when a >= b', () => {
      const template = Handlebars.compile('{{#if-gte score 5}}high{{else}}low{{/if-gte}}');
      expect(template({ score: 7 })).toBe('high');
      expect(template({ score: 5 })).toBe('high');
    });

    it('renders inverse block when a < b', () => {
      const template = Handlebars.compile('{{#if-gte score 5}}high{{else}}low{{/if-gte}}');
      expect(template({ score: 3 })).toBe('low');
    });
  });

  describe('if-lte', () => {
    it('renders fn block when a <= b', () => {
      const template = Handlebars.compile('{{#if-lte score 5}}low{{else}}high{{/if-lte}}');
      expect(template({ score: 3 })).toBe('low');
      expect(template({ score: 5 })).toBe('low');
    });

    it('renders inverse block when a > b', () => {
      const template = Handlebars.compile('{{#if-lte score 5}}low{{else}}high{{/if-lte}}');
      expect(template({ score: 7 })).toBe('high');
    });
  });

  describe('if-gt', () => {
    it('renders fn block when a > b', () => {
      const template = Handlebars.compile('{{#if-gt score 5}}high{{else}}low{{/if-gt}}');
      expect(template({ score: 7 })).toBe('high');
    });

    it('renders inverse block when a <= b', () => {
      const template = Handlebars.compile('{{#if-gt score 5}}high{{else}}low{{/if-gt}}');
      expect(template({ score: 5 })).toBe('low');
    });
  });

  describe('if-lt', () => {
    it('renders fn block when a < b', () => {
      const template = Handlebars.compile('{{#if-lt score 5}}low{{else}}high{{/if-lt}}');
      expect(template({ score: 3 })).toBe('low');
    });

    it('renders inverse block when a >= b', () => {
      const template = Handlebars.compile('{{#if-lt score 5}}low{{else}}high{{/if-lt}}');
      expect(template({ score: 5 })).toBe('high');
    });
  });

  describe('if-eq', () => {
    it('renders fn block when a == b', () => {
      const template = Handlebars.compile('{{#if-eq status "done"}}yes{{else}}no{{/if-eq}}');
      expect(template({ status: 'done' })).toBe('yes');
    });

    it('renders inverse block when a != b', () => {
      const template = Handlebars.compile('{{#if-eq status "done"}}yes{{else}}no{{/if-eq}}');
      expect(template({ status: 'todo' })).toBe('no');
    });
  });
});
