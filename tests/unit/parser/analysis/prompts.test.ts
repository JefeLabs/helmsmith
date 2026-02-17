import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildArchitectureDiscoveryPrompt,
  buildTaskGenerationPrompt,
} from '../../../../src/parser/analysis/prompts.js';
import type { ArchitectureAnalysis, CodebaseScanResult, SourceAnalysisResult } from '../../../../src/parser/analysis/types.js';

const fixturesDir = join(import.meta.dirname, '../../../fixtures/analysis');

describe('buildArchitectureDiscoveryPrompt', () => {
  const prd = '# My Project\n\nBuild a REST API for user management.';

  it('creates system and user messages', () => {
    const messages = buildArchitectureDiscoveryPrompt(prd);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes PRD in user message', () => {
    const messages = buildArchitectureDiscoveryPrompt(prd);

    expect(messages[1].content).toContain('=== PROJECT DOCUMENT ===');
    expect(messages[1].content).toContain('REST API for user management');
  });

  it('includes JSON schema guidance in system prompt', () => {
    const messages = buildArchitectureDiscoveryPrompt(prd);

    expect(messages[0].content).toContain('components');
    expect(messages[0].content).toContain('interfaces');
    expect(messages[0].content).toContain('dataSources');
    expect(messages[0].content).toContain('crossCuttingConcerns');
  });

  it('includes codebase scan when provided', () => {
    const scan: CodebaseScanResult = {
      rootPath: '/project',
      directoryTree: 'src/\n  index.ts',
      fileExtensions: { '.ts': 5 },
      manifestContents: {},
      detectedPatterns: ['typescript'],
      capabilities: [],
      totalFiles: 5,
      totalDirectories: 1,
    };

    const messages = buildArchitectureDiscoveryPrompt(prd, scan);

    expect(messages[1].content).toContain('=== CODEBASE SCAN ===');
    expect(messages[1].content).toContain('src/');
  });

  it('includes source analysis when provided', () => {
    const source: SourceAnalysisResult = {
      files: [],
      publicApi: [],
      summary: 'src/\n  function handleAuth',
    };

    const messages = buildArchitectureDiscoveryPrompt(prd, null, source);

    expect(messages[1].content).toContain('=== SOURCE ANALYSIS ===');
    expect(messages[1].content).toContain('handleAuth');
  });

  it('omits scan sections when not provided', () => {
    const messages = buildArchitectureDiscoveryPrompt(prd);

    expect(messages[1].content).not.toContain('=== CODEBASE SCAN ===');
    expect(messages[1].content).not.toContain('=== SOURCE ANALYSIS ===');
    expect(messages[1].content).not.toContain('=== COMPONENT INDEX ===');
  });

  it('includes component index summary when provided', () => {
    const summary = 'Components (1):\n\n  [my-service] (langs: typescript)\n    Build: npm run build';

    const messages = buildArchitectureDiscoveryPrompt(prd, null, null, summary);

    expect(messages[1].content).toContain('=== COMPONENT INDEX ===');
    expect(messages[1].content).toContain('my-service');
    expect(messages[1].content).toContain('npm run build');
  });

  it('omits component index when null', () => {
    const messages = buildArchitectureDiscoveryPrompt(prd, null, null, null);

    expect(messages[1].content).not.toContain('=== COMPONENT INDEX ===');
  });
});

describe('buildTaskGenerationPrompt', () => {
  const analysis: ArchitectureAnalysis = JSON.parse(
    readFileSync(join(fixturesDir, 'sample-analysis.json'), 'utf-8'),
  );
  const prd = '# E-commerce Platform\n\nBuild a full-stack e-commerce app.';

  it('creates system and user messages', () => {
    const messages = buildTaskGenerationPrompt(analysis, prd, { style: 'task-only' });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes architecture analysis in user message', () => {
    const messages = buildTaskGenerationPrompt(analysis, prd, { style: 'task-only' });

    expect(messages[1].content).toContain('=== ARCHITECTURE ANALYSIS ===');
    expect(messages[1].content).toContain('auth-service');
    expect(messages[1].content).toContain('product-catalog');
  });

  it('includes original document in user message', () => {
    const messages = buildTaskGenerationPrompt(analysis, prd, { style: 'task-only' });

    expect(messages[1].content).toContain('=== ORIGINAL DOCUMENT ===');
    expect(messages[1].content).toContain('e-commerce app');
  });

  it('includes tagging convention in system prompt', () => {
    const messages = buildTaskGenerationPrompt(analysis, prd, { style: 'task-only' });

    expect(messages[0].content).toContain('component:<name>');
    expect(messages[0].content).toContain('layer:<layer>');
    expect(messages[0].content).toContain('concern:<name>');
    expect(messages[0].content).toContain('interface:<from>-to-<to>');
    expect(messages[0].content).toContain('datasource:<name>');
  });

  it('includes numTasks hint when provided', () => {
    const messages = buildTaskGenerationPrompt(analysis, prd, { style: 'task-only', numTasks: 10 });

    expect(messages[0].content).toContain('approximately 10');
  });

  it('uses default numTasks hint when not provided', () => {
    const messages = buildTaskGenerationPrompt(analysis, prd, { style: 'task-only' });

    expect(messages[0].content).toContain('typically 5-15');
  });

  it('uses 8 pragmatic layers in tagging guidance', () => {
    const messages = buildTaskGenerationPrompt(analysis, prd, { style: 'task-only' });

    const systemPrompt = messages[0].content;
    // Should reference all 8 pragmatic layers
    expect(systemPrompt).toContain('api');
    expect(systemPrompt).toContain('service');
    expect(systemPrompt).toContain('domain');
    expect(systemPrompt).toContain('infra');
    expect(systemPrompt).toContain('cli');
    expect(systemPrompt).toContain('scripts');
    expect(systemPrompt).toContain('tests');
    // Should NOT reference old AI-centric layers
    expect(systemPrompt).not.toContain('"layer:backend"');
    expect(systemPrompt).not.toContain('"layer:frontend"');
  });
});
