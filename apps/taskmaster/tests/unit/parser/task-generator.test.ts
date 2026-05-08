import { describe, it, expect } from 'vitest';
import { generateTasks, getNextId, renumberTasks } from '../../../src/parser/task-generator.js';
import type { ParsedSection } from '../../../src/parser/types.js';
import type { TaskNode } from '../../../src/config/schema.js';

const defaultOptions = {
  style: 'task-only',
  defaultStatus: 'todo',
};

function makeSection(
  title: string,
  depth: number,
  body: string = '',
  children: ParsedSection[] = [],
): ParsedSection {
  return { title, depth, body, children };
}

describe('generateTasks', () => {
  it('generates flat task list with correct IDs', () => {
    const sections: ParsedSection[] = [
      makeSection('Task A', 1, 'Body A'),
      makeSection('Task B', 1, 'Body B'),
      makeSection('Task C', 1, 'Body C'),
    ];

    const { tasks, warnings } = generateTasks(sections, defaultOptions);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe('1');
    expect(tasks[1].id).toBe('2');
    expect(tasks[2].id).toBe('3');
    expect(warnings).toHaveLength(0);
  });

  it('generates nested IDs for children', () => {
    const sections: ParsedSection[] = [
      makeSection('Parent', 1, 'Parent body', [
        makeSection('Child 1', 2, 'Child 1 body'),
        makeSection('Child 2', 2, 'Child 2 body'),
      ]),
    ];

    const { tasks } = generateTasks(sections, defaultOptions);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('1');
    expect(tasks[0].children).toHaveLength(2);
    expect(tasks[0].children[0].id).toBe('1.1');
    expect(tasks[0].children[1].id).toBe('1.2');
  });

  it('generates three levels of IDs', () => {
    const sections: ParsedSection[] = [
      makeSection('L1', 1, '', [
        makeSection('L2', 2, '', [
          makeSection('L3', 3, 'Deep body'),
        ]),
      ]),
    ];

    const { tasks } = generateTasks(sections, { ...defaultOptions, style: 'story-driven' });

    expect(tasks[0].id).toBe('1');
    expect(tasks[0].children[0].id).toBe('1.1');
    expect(tasks[0].children[0].children[0].id).toBe('1.1.1');
  });

  it('maps heading depth to correct type for task-only style', () => {
    const sections: ParsedSection[] = [
      makeSection('Task', 1, '', [
        makeSection('Subtask', 2, ''),
      ]),
    ];

    const { tasks } = generateTasks(sections, { ...defaultOptions, style: 'task-only' });

    expect(tasks[0].type).toBe('task');
    expect(tasks[0].children[0].type).toBe('subtask');
  });

  it('maps heading depth to correct type for agile-full style', () => {
    const sections: ParsedSection[] = [
      makeSection('Epic', 1, '', [
        makeSection('Story', 2, '', [
          makeSection('Task', 3, '', [
            makeSection('Subtask', 4, ''),
          ]),
        ]),
      ]),
    ];

    const { tasks } = generateTasks(sections, { ...defaultOptions, style: 'agile-full' });

    expect(tasks[0].type).toBe('epic');
    expect(tasks[0].children[0].type).toBe('story');
    expect(tasks[0].children[0].children[0].type).toBe('task');
    expect(tasks[0].children[0].children[0].children[0].type).toBe('subtask');
  });

  it('maps heading depth to correct type for story-driven style', () => {
    const sections: ParsedSection[] = [
      makeSection('Story', 1, '', [
        makeSection('Task', 2, '', [
          makeSection('Subtask', 3, ''),
        ]),
      ]),
    ];

    const { tasks } = generateTasks(sections, { ...defaultOptions, style: 'story-driven' });

    expect(tasks[0].type).toBe('story');
    expect(tasks[0].children[0].type).toBe('task');
    expect(tasks[0].children[0].children[0].type).toBe('subtask');
  });

  it('maps all headings to task for flat style', () => {
    const sections: ParsedSection[] = [
      makeSection('Task A', 1),
      makeSection('Task B', 1),
    ];

    const { tasks } = generateTasks(sections, { ...defaultOptions, style: 'flat' });

    expect(tasks[0].type).toBe('task');
    expect(tasks[1].type).toBe('task');
  });

  it('collapses headings beyond maxDepth with warning', () => {
    const sections: ParsedSection[] = [
      makeSection('Task', 1, '', [
        makeSection('Subtask', 2, '', [
          makeSection('Too Deep', 3, ''),
        ]),
      ]),
    ];

    // task-only has maxDepth 2, so depth 3 should collapse to subtask
    const { tasks, warnings } = generateTasks(sections, { ...defaultOptions, style: 'task-only' });

    expect(tasks[0].children[0].children[0].type).toBe('subtask');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Too Deep');
    expect(warnings[0]).toContain('depth 3');
  });

  it('sets default status from options', () => {
    const sections: ParsedSection[] = [makeSection('Task', 1)];
    const { tasks } = generateTasks(sections, { ...defaultOptions, defaultStatus: 'backlog' });

    expect(tasks[0].status).toBe('backlog');
  });

  it('sets complexity to 1 by default', () => {
    const sections: ParsedSection[] = [makeSection('Task', 1)];
    const { tasks } = generateTasks(sections, defaultOptions);

    expect(tasks[0].complexity).toBe(1);
  });

  it('sets readiness to pending by default', () => {
    const sections: ParsedSection[] = [makeSection('Task', 1)];
    const { tasks } = generateTasks(sections, defaultOptions);

    expect(tasks[0].readiness).toBe('pending');
  });

  it('sets requiredSkills to empty array by default', () => {
    const sections: ParsedSection[] = [makeSection('Task', 1)];
    const { tasks } = generateTasks(sections, defaultOptions);

    expect(tasks[0].requiredSkills).toEqual([]);
  });

  it('preserves priority from ParsedSection', () => {
    const sections: ParsedSection[] = [
      { title: 'Critical Task', depth: 1, body: '', children: [], priority: 'critical' },
    ];
    const { tasks } = generateTasks(sections, defaultOptions);

    expect(tasks[0].priority).toBe('critical');
  });

  it('preserves tags from ParsedSection', () => {
    const sections: ParsedSection[] = [
      { title: 'Tagged Task', depth: 1, body: '', children: [], tags: ['backend', 'api'] },
    ];
    const { tasks } = generateTasks(sections, defaultOptions);

    expect(tasks[0].tags).toEqual(['backend', 'api']);
  });

  it('uses startId parameter for append mode', () => {
    const sections: ParsedSection[] = [
      makeSection('New Task A', 1),
      makeSection('New Task B', 1),
    ];

    const { tasks } = generateTasks(sections, defaultOptions, 17);

    expect(tasks[0].id).toBe('17');
    expect(tasks[1].id).toBe('18');
  });

  describe('--num-tasks merging', () => {
    it('merges sections when count exceeds numTasks', () => {
      const sections: ParsedSection[] = [
        makeSection('A', 1, 'Body A'),
        makeSection('B', 1, 'Body B'),
        makeSection('C', 1, 'Body C'),
        makeSection('D', 1, 'Body D'),
      ];

      const { tasks } = generateTasks(sections, { ...defaultOptions, numTasks: 3 });

      expect(tasks).toHaveLength(3);
    });

    it('does not merge when count is within target', () => {
      const sections: ParsedSection[] = [
        makeSection('A', 1, 'Body A'),
        makeSection('B', 1, 'Body B'),
      ];

      const { tasks } = generateTasks(sections, { ...defaultOptions, numTasks: 5 });

      expect(tasks).toHaveLength(2);
    });

    it('merges down to numTasks=1', () => {
      const sections: ParsedSection[] = [
        makeSection('A', 1, 'Body A'),
        makeSection('B', 1, 'Body B'),
        makeSection('C', 1, 'Body C'),
      ];

      const { tasks } = generateTasks(sections, { ...defaultOptions, numTasks: 1 });

      expect(tasks).toHaveLength(1);
    });
  });
});

describe('getNextId', () => {
  it('returns 1 for empty array', () => {
    expect(getNextId([])).toBe(1);
  });

  it('returns max + 1 for flat tasks', () => {
    const tasks = [
      { id: '1', children: [] },
      { id: '2', children: [] },
      { id: '3', children: [] },
    ] as TaskNode[];

    expect(getNextId(tasks)).toBe(4);
  });

  it('scans children for max ID', () => {
    const tasks = [
      {
        id: '5',
        children: [
          { id: '5.1', children: [] },
          { id: '5.2', children: [] },
        ],
      },
    ] as TaskNode[];

    expect(getNextId(tasks)).toBe(6);
  });

  it('handles non-sequential IDs', () => {
    const tasks = [
      { id: '3', children: [] },
      { id: '10', children: [] },
      { id: '7', children: [] },
    ] as TaskNode[];

    expect(getNextId(tasks)).toBe(11);
  });
});

describe('renumberTasks', () => {
  it('renumbers top-level tasks starting from given ID', () => {
    const tasks = [
      { id: '1', title: 'A', children: [] },
      { id: '2', title: 'B', children: [] },
    ] as TaskNode[];

    const renumbered = renumberTasks(tasks, 17);

    expect(renumbered[0].id).toBe('17');
    expect(renumbered[1].id).toBe('18');
  });

  it('renumbers children recursively', () => {
    const tasks = [
      {
        id: '1',
        title: 'Parent',
        children: [
          { id: '1.1', title: 'Child', children: [] },
        ],
      },
    ] as TaskNode[];

    const renumbered = renumberTasks(tasks, 5);

    expect(renumbered[0].id).toBe('5');
    expect(renumbered[0].children[0].id).toBe('5.1');
  });

  it('preserves task fields other than id', () => {
    const tasks = [
      { id: '1', title: 'Keep Me', description: 'Original', children: [] },
    ] as TaskNode[];

    const renumbered = renumberTasks(tasks, 99);

    expect(renumbered[0].id).toBe('99');
    expect(renumbered[0].title).toBe('Keep Me');
    expect(renumbered[0].description).toBe('Original');
  });
});
