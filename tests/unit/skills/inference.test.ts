import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskNode } from '../../../src/config/schema.js';
import type { ProjectConfig } from '../../../src/config/schema.js';

// Mock the auth modules before importing inference
vi.mock('../../../src/auth/call-ai.js', () => ({
  callAI: vi.fn(),
  resolveActiveAuth: vi.fn(),
}));

import {
  getEffectiveVocabulary,
  inferSkillsByKeyword,
  buildSkillInferencePrompt,
  parseSkillInferenceResponse,
  inferSkillsForTask,
  inferSkills,
  inheritSkills,
} from '../../../src/skills/inference.js';
import { BUILT_IN_SKILLS } from '../../../src/skills/types.js';
import { callAI, resolveActiveAuth } from '../../../src/auth/call-ai.js';

const mockedCallAI = vi.mocked(callAI);
const mockedResolveActiveAuth = vi.mocked(resolveActiveAuth);

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

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    style: 'task-only',
    states: { preset: 'standard', enforce_transitions: false },
    skills: { vocabulary: [], auto_infer: true },
    ai: { model: 'claude-sonnet-4-20250514' },
    thresholds: { expand: 5, flag: 8 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- getEffectiveVocabulary ---

describe('getEffectiveVocabulary', () => {
  it('returns built-in skills when config vocabulary is empty', () => {
    const vocab = getEffectiveVocabulary([]);
    expect(vocab).toEqual([...BUILT_IN_SKILLS].sort());
  });

  it('merges custom skills with built-in skills', () => {
    const vocab = getEffectiveVocabulary(['graphql', 'mobile']);
    expect(vocab).toContain('backend');
    expect(vocab).toContain('graphql');
    expect(vocab).toContain('mobile');
  });

  it('deduplicates when custom vocabulary overlaps with built-in', () => {
    const vocab = getEffectiveVocabulary(['backend', 'frontend', 'custom-skill']);
    const backendCount = vocab.filter((s) => s === 'backend').length;
    expect(backendCount).toBe(1);
    expect(vocab).toContain('custom-skill');
  });

  it('returns sorted results', () => {
    const vocab = getEffectiveVocabulary(['zebra', 'alpha']);
    for (let i = 1; i < vocab.length; i++) {
      expect(vocab[i] >= vocab[i - 1]).toBe(true);
    }
  });
});

// --- inferSkillsByKeyword ---

describe('inferSkillsByKeyword', () => {
  const defaultVocab = [...BUILT_IN_SKILLS];

  it('matches backend keywords', () => {
    const task = makeTask({ title: 'Build REST API endpoint' });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    expect(skills).toContain('backend');
  });

  it('matches frontend keywords', () => {
    const task = makeTask({ title: 'Create login form component' });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    expect(skills).toContain('frontend');
  });

  it('matches database keywords', () => {
    const task = makeTask({ description: 'Write SQL migration for user table' });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    expect(skills).toContain('database');
  });

  it('matches multiple skills from one task', () => {
    const task = makeTask({
      title: 'Build API endpoint with OAuth authentication',
      description: 'Includes database query for user tokens',
    });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    expect(skills).toContain('backend');
    expect(skills).toContain('auth');
    expect(skills).toContain('database');
  });

  it('uses word boundary matching to avoid partial matches', () => {
    const task = makeTask({ title: 'Transform data format' });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    // "form" is a frontend keyword, but "transform" should NOT match it
    expect(skills).not.toContain('frontend');
  });

  it('filters results to vocabulary only', () => {
    const task = makeTask({ title: 'Build API endpoint' });
    const limitedVocab = ['frontend', 'database'];
    const skills = inferSkillsByKeyword(task, limitedVocab);
    // "api" matches "backend", but "backend" is not in the limited vocabulary
    expect(skills).not.toContain('backend');
  });

  it('returns empty array when no keywords match', () => {
    const task = makeTask({ title: 'Something completely unrelated' });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    expect(skills).toEqual([]);
  });

  it('is case-insensitive', () => {
    const task = makeTask({ title: 'Build REST API Endpoint' });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    expect(skills).toContain('backend');
  });

  it('matches multi-word keywords with slash', () => {
    const task = makeTask({ title: 'Set up CI/CD pipeline' });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    expect(skills).toContain('devops');
  });

  it('returns sorted results', () => {
    const task = makeTask({
      title: 'Build API with tests and deploy',
      description: 'Database schema plus auth tokens',
    });
    const skills = inferSkillsByKeyword(task, defaultVocab);
    for (let i = 1; i < skills.length; i++) {
      expect(skills[i] >= skills[i - 1]).toBe(true);
    }
  });
});

// --- buildSkillInferencePrompt ---

describe('buildSkillInferencePrompt', () => {
  it('builds valid message array', () => {
    const task = makeTask({ title: 'Build API', description: 'REST endpoint' });
    const vocab = ['backend', 'frontend'];
    const messages = buildSkillInferencePrompt(task, vocab);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes task title and description in user message', () => {
    const task = makeTask({ title: 'My Task', description: 'My Description' });
    const messages = buildSkillInferencePrompt(task, ['backend']);

    expect(messages[1].content).toContain('My Task');
    expect(messages[1].content).toContain('My Description');
  });

  it('includes vocabulary in user message', () => {
    const vocab = ['backend', 'frontend', 'database'];
    const task = makeTask({});
    const messages = buildSkillInferencePrompt(task, vocab);

    expect(messages[1].content).toContain(JSON.stringify(vocab));
  });

  it('system prompt requests JSON-only output', () => {
    const messages = buildSkillInferencePrompt(makeTask({}), []);
    expect(messages[0].content).toContain('ONLY a JSON object');
    expect(messages[0].content).toContain('{"skills":');
  });
});

// --- parseSkillInferenceResponse ---

describe('parseSkillInferenceResponse', () => {
  const vocab = ['backend', 'frontend', 'database'];

  it('parses valid JSON response', () => {
    const content = '{"skills": ["backend", "database"]}';
    const result = parseSkillInferenceResponse(content, vocab);
    expect(result).toEqual(['backend', 'database']);
  });

  it('strips markdown code fences', () => {
    const content = '```json\n{"skills": ["frontend"]}\n```';
    const result = parseSkillInferenceResponse(content, vocab);
    expect(result).toEqual(['frontend']);
  });

  it('filters out skills not in vocabulary', () => {
    const content = '{"skills": ["backend", "graphql", "unknown"]}';
    const result = parseSkillInferenceResponse(content, vocab);
    expect(result).toEqual(['backend']);
  });

  it('returns null for invalid JSON', () => {
    const result = parseSkillInferenceResponse('not json', vocab);
    expect(result).toBeNull();
  });

  it('returns null for missing skills array', () => {
    const result = parseSkillInferenceResponse('{"score": 5}', vocab);
    expect(result).toBeNull();
  });

  it('returns null when all skills are out of vocabulary', () => {
    const result = parseSkillInferenceResponse('{"skills": ["graphql"]}', vocab);
    expect(result).toBeNull();
  });

  it('returns null for empty skills array', () => {
    const result = parseSkillInferenceResponse('{"skills": []}', vocab);
    expect(result).toBeNull();
  });

  it('handles whitespace around JSON', () => {
    const content = '  \n  {"skills": ["backend"]}  \n  ';
    const result = parseSkillInferenceResponse(content, vocab);
    expect(result).toEqual(['backend']);
  });

  it('filters out non-string values in skills array', () => {
    const content = '{"skills": ["backend", 42, null, "frontend"]}';
    const result = parseSkillInferenceResponse(content, vocab);
    expect(result).toEqual(['backend', 'frontend']);
  });
});

// --- inferSkillsForTask ---

describe('inferSkillsForTask', () => {
  const vocab = ['backend', 'frontend', 'database', 'auth', 'testing'];

  it('uses AI when available and returns AI result', async () => {
    mockedCallAI.mockResolvedValue({
      choices: [{ message: { content: '{"skills": ["backend", "auth"]}' } }],
    });

    const task = makeTask({ title: 'Build auth API' });
    const result = await inferSkillsForTask(task, vocab, 'test-model', true);

    expect(result.method).toBe('ai');
    expect(result.skills).toEqual(['backend', 'auth']);
  });

  it('falls back to keyword when AI fails', async () => {
    mockedCallAI.mockRejectedValue(new Error('API error'));

    const task = makeTask({ title: 'Build API endpoint' });
    const result = await inferSkillsForTask(task, vocab, 'test-model', true);

    expect(result.method).toBe('keyword');
    expect(result.skills).toContain('backend');
  });

  it('falls back to keyword when AI returns invalid response', async () => {
    mockedCallAI.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });

    const task = makeTask({ title: 'Write unit tests' });
    const result = await inferSkillsForTask(task, vocab, 'test-model', true);

    expect(result.method).toBe('keyword');
    expect(result.skills).toContain('testing');
  });

  it('uses keyword-only when AI is not available', async () => {
    const task = makeTask({ title: 'Build API endpoint' });
    const result = await inferSkillsForTask(task, vocab, 'test-model', false);

    expect(result.method).toBe('keyword');
    expect(result.skills).toContain('backend');
    expect(mockedCallAI).not.toHaveBeenCalled();
  });

  it('includes correct taskId in result', async () => {
    const task = makeTask({ id: 'T-5', title: 'Something' });
    const result = await inferSkillsForTask(task, vocab, 'test-model', false);
    expect(result.taskId).toBe('T-5');
  });
});

// --- inferSkills ---

describe('inferSkills', () => {
  it('returns early when auto_infer is false', async () => {
    const config = makeConfig({ skills: { vocabulary: [], auto_infer: false } });
    const tasks = [makeTask({ title: 'Build API' })];

    const results = await inferSkills(tasks, config);
    expect(results).toEqual([]);
    expect(tasks[0].requiredSkills).toEqual([]);
  });

  it('infers skills for all tasks and mutates requiredSkills', async () => {
    mockedResolveActiveAuth.mockResolvedValue(null); // No AI
    const config = makeConfig();
    const tasks = [
      makeTask({ id: '1', title: 'Build API endpoint' }),
      makeTask({ id: '2', title: 'Write unit tests' }),
    ];

    const results = await inferSkills(tasks, config);

    expect(results).toHaveLength(2);
    expect(tasks[0].requiredSkills).toContain('backend');
    expect(tasks[1].requiredSkills).toContain('testing');
    expect(tasks[0].metadata.skillsInferred).toBe(true);
    expect(tasks[1].metadata.skillsInferred).toBe(true);
  });

  it('uses AI when authenticated', async () => {
    mockedResolveActiveAuth.mockResolvedValue({ source: 'auth.json' });
    mockedCallAI.mockResolvedValue({
      choices: [{ message: { content: '{"skills": ["backend"]}' } }],
    });

    const config = makeConfig();
    const tasks = [makeTask({ id: '1', title: 'Build API' })];

    const results = await inferSkills(tasks, config);

    expect(results[0].method).toBe('ai');
    expect(mockedCallAI).toHaveBeenCalled();
  });
});

// --- inheritSkills ---

describe('inheritSkills', () => {
  it('copies parent skills to subtasks', async () => {
    mockedResolveActiveAuth.mockResolvedValue(null);
    const config = makeConfig({ skills: { vocabulary: [], auto_infer: false } });

    const parent = makeTask({
      id: '1',
      requiredSkills: ['backend', 'database'],
    });
    const subtasks = [
      makeTask({ id: '1.1', title: 'Subtask A' }),
      makeTask({ id: '1.2', title: 'Subtask B' }),
    ];

    const result = await inheritSkills(parent, subtasks, config);

    expect(result[0].requiredSkills).toEqual(['backend', 'database']);
    expect(result[1].requiredSkills).toEqual(['backend', 'database']);
  });

  it('sets skillsInferred metadata on subtasks', async () => {
    mockedResolveActiveAuth.mockResolvedValue(null);
    const config = makeConfig({ skills: { vocabulary: [], auto_infer: false } });

    const parent = makeTask({ requiredSkills: ['backend'] });
    const subtasks = [makeTask({ id: '1.1' })];

    await inheritSkills(parent, subtasks, config);
    expect(subtasks[0].metadata.skillsInferred).toBe(true);
  });

  it('adds AI-inferred skills without removing inherited ones', async () => {
    mockedResolveActiveAuth.mockResolvedValue({ source: 'auth.json' });
    mockedCallAI.mockResolvedValue({
      choices: [{ message: { content: '{"skills": ["testing"]}' } }],
    });

    const config = makeConfig();
    const parent = makeTask({ requiredSkills: ['backend', 'database'] });
    const subtasks = [makeTask({ id: '1.1', title: 'Write integration tests' })];

    const result = await inheritSkills(parent, subtasks, config);

    // Should have parent skills PLUS AI-inferred "testing"
    expect(result[0].requiredSkills).toContain('backend');
    expect(result[0].requiredSkills).toContain('database');
    expect(result[0].requiredSkills).toContain('testing');
  });

  it('keeps inherited skills on AI failure', async () => {
    mockedResolveActiveAuth.mockResolvedValue({ source: 'auth.json' });
    mockedCallAI.mockRejectedValue(new Error('API error'));

    const config = makeConfig();
    const parent = makeTask({ requiredSkills: ['backend'] });
    // Use a title that does not match any skill keywords, so keyword fallback adds nothing
    const subtasks = [makeTask({ id: '1.1', title: 'Do something', description: '' })];

    const result = await inheritSkills(parent, subtasks, config);
    expect(result[0].requiredSkills).toEqual(['backend']);
  });
});
