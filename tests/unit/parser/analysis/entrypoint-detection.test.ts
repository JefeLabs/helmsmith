import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectEntryPointsFromAST,
  detectEntryPointsFromManifest,
  detectFileBasedRoutes,
  detectEntryPoints,
} from '../../../../src/parser/analysis/entrypoint-detection.js';
import type { EnhancedFileAnalysis, BuildComponent } from '../../../../src/parser/analysis/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ep-detect-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSource(relPath: string, content: string): void {
  const fullPath = join(tmpDir, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

function makeEnhancedFile(path: string, symbols: EnhancedFileAnalysis['symbols'] = []): EnhancedFileAnalysis {
  return {
    path,
    language: 'typescript',
    symbols,
    layer: 'api',
    componentId: 'test-service',
  };
}

function makeComponent(id: string, rootPath: string): BuildComponent {
  return {
    id,
    name: id,
    rootPath,
    languageSet: ['typescript'],
    entrypoints: [],
    entryPointIds: [],
    publicSurface: [],
    tags: [],
  };
}

describe('detectEntryPointsFromAST', () => {
  describe('http-api detection', () => {
    it('detects Express-style app.get/post routes', async () => {
      const source = `
import express from 'express';
const app = express();
app.get('/api/users', getUsers);
app.post('/api/auth/login', handleLogin);
`;
      writeSource('src/routes/auth.ts', source);
      const files = [makeEnhancedFile('src/routes/auth.ts')];
      const result = await detectEntryPointsFromAST(tmpDir, files, []);

      expect(result.length).toBeGreaterThanOrEqual(2);
      const getRoute = result.find(ep => ep.name.includes('GET /api/users'));
      const postRoute = result.find(ep => ep.name.includes('POST /api/auth/login'));
      expect(getRoute).toBeDefined();
      expect(getRoute!.category).toBe('http-api');
      expect(getRoute!.metadata.method).toBe('GET');
      expect(postRoute).toBeDefined();
      expect(postRoute!.metadata.path).toBe('/api/auth/login');
    });

    it('detects router.post patterns', async () => {
      writeSource('src/routes/items.ts', `
const router = express.Router();
router.post('/items', createItem);
`);
      const files = [makeEnhancedFile('src/routes/items.ts')];
      const result = await detectEntryPointsFromAST(tmpDir, files, []);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].category).toBe('http-api');
      expect(result[0].metadata.method).toBe('POST');
    });

    it('detects NestJS decorator patterns', async () => {
      writeSource('src/controllers/auth.ts', `
@Controller('auth')
class AuthController {
  @Post('/login')
  handleLogin() {}
}
`);
      const files = [makeEnhancedFile('src/controllers/auth.ts')];
      const result = await detectEntryPointsFromAST(tmpDir, files, []);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].category).toBe('http-api');
    });
  });

  describe('cli-command detection', () => {
    it('detects Commander.js command patterns', async () => {
      writeSource('src/cli.ts', `
import { Command } from 'commander';
const program = new Command();
program.command('parse <file>');
program.command('scan [path]');
`);
      const files = [makeEnhancedFile('src/cli.ts')];
      const result = await detectEntryPointsFromAST(tmpDir, files, []);

      const cmdEntries = result.filter(ep => ep.category === 'cli-command');
      expect(cmdEntries.length).toBeGreaterThanOrEqual(2);
      expect(cmdEntries.some(ep => ep.metadata.commandName === 'parse <file>')).toBe(true);
    });

    it('detects symbols with kind:command tag', async () => {
      const files: EnhancedFileAnalysis[] = [{
        path: 'bin/cli.ts',
        language: 'typescript',
        symbols: [{
          name: 'generateCommand',
          kind: 'command',
          visibility: 'exported',
          filePath: 'bin/cli.ts',
          source: { file: '/abs/bin/cli.ts', range: { startLine: 1, endLine: 10 } },
          tags: ['kind:command', 'layer:cli'],
        }],
        layer: 'cli',
        componentId: 'cli-tool',
      }];

      // Write a dummy file so readFile doesn't fail
      writeSource('bin/cli.ts', 'export function generateCommand() {}');

      const result = await detectEntryPointsFromAST(tmpDir, files, []);
      const cmdEntry = result.find(ep => ep.symbolName === 'generateCommand');
      expect(cmdEntry).toBeDefined();
      expect(cmdEntry!.category).toBe('cli-command');
    });
  });

  describe('event detection', () => {
    it('detects .subscribe() event patterns', async () => {
      writeSource('src/events/handler.ts', `
eventBus.subscribe('order.created', onOrderCreated);
`);
      const files = [makeEnhancedFile('src/events/handler.ts')];
      const result = await detectEntryPointsFromAST(tmpDir, files, []);

      const eventEntry = result.find(ep => ep.category === 'event');
      expect(eventEntry).toBeDefined();
      expect(eventEntry!.metadata.eventName).toBe('order.created');
    });
  });

  describe('job-cron detection', () => {
    it('detects cron.schedule patterns', async () => {
      writeSource('src/jobs/cleanup.ts', `
cron.schedule('0 2 * * *', cleanupJob);
`);
      const files = [makeEnhancedFile('src/jobs/cleanup.ts')];
      const result = await detectEntryPointsFromAST(tmpDir, files, []);

      const cronEntry = result.find(ep => ep.category === 'job-cron');
      expect(cronEntry).toBeDefined();
      expect(cronEntry!.name).toContain('Cron');
    });
  });

  describe('callback-webhook detection', () => {
    it('detects webhook URL patterns', async () => {
      writeSource('src/routes/webhook.ts', `
app.post('/webhook/stripe', handleStripeWebhook);
`);
      const files = [makeEnhancedFile('src/routes/webhook.ts')];
      const result = await detectEntryPointsFromAST(tmpDir, files, []);

      const webhookEntries = result.filter(ep => ep.category === 'callback-webhook');
      expect(webhookEntries.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('deduplicates by id', async () => {
    writeSource('src/routes/api.ts', `
app.get('/api/health', healthCheck);
app.get('/api/health', healthCheck);
`);
    const files = [makeEnhancedFile('src/routes/api.ts')];
    const result = await detectEntryPointsFromAST(tmpDir, files, []);

    const healthEntries = result.filter(ep => ep.name.includes('/api/health'));
    expect(healthEntries).toHaveLength(1);
  });

  it('returns empty array for files with no entry points', async () => {
    writeSource('src/utils/math.ts', `
export function add(a: number, b: number): number { return a + b; }
`);
    const files = [makeEnhancedFile('src/utils/math.ts')];
    const result = await detectEntryPointsFromAST(tmpDir, files, []);

    expect(result).toHaveLength(0);
  });
});

describe('detectEntryPointsFromManifest', () => {
  it('detects bin field as string', async () => {
    const comp = makeComponent('my-cli', tmpDir);
    writeSource('package.json', JSON.stringify({
      name: 'my-cli',
      bin: './bin/cli.js',
    }));

    const result = await detectEntryPointsFromManifest(tmpDir, [comp]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('cli-command');
    expect(result[0].detectedBy).toBe('manifest');
    expect(result[0].confidence).toBe(1.0);
    expect(result[0].filePath).toBe('./bin/cli.js');
  });

  it('detects bin field as object with multiple commands', async () => {
    const comp = makeComponent('multi-cli', tmpDir);
    writeSource('package.json', JSON.stringify({
      name: 'multi-cli',
      bin: {
        'do-thing': './bin/do-thing.js',
        'other-cmd': './bin/other.js',
      },
    }));

    const result = await detectEntryPointsFromManifest(tmpDir, [comp]);
    expect(result).toHaveLength(2);
    expect(result.every(ep => ep.category === 'cli-command')).toBe(true);
    expect(result.some(ep => ep.metadata.binName === 'do-thing')).toBe(true);
  });

  it('detects start script as internal-service', async () => {
    const comp = makeComponent('api', tmpDir);
    writeSource('package.json', JSON.stringify({
      name: 'api',
      main: 'src/index.js',
      scripts: { start: 'node src/index.js' },
    }));

    const result = await detectEntryPointsFromManifest(tmpDir, [comp]);
    const startEntry = result.find(ep => ep.name.includes('start'));
    expect(startEntry).toBeDefined();
    expect(startEntry!.category).toBe('internal-service');
  });

  it('returns empty for components without package.json', async () => {
    const comp = makeComponent('no-pkg', join(tmpDir, 'nonexistent'));
    const result = await detectEntryPointsFromManifest(tmpDir, [comp]);
    expect(result).toHaveLength(0);
  });
});

describe('detectFileBasedRoutes', () => {
  it('detects Next.js pages directory', async () => {
    mkdirSync(join(tmpDir, 'pages'), { recursive: true });
    writeSource('next.config.js', 'module.exports = {}');

    const comp = makeComponent('frontend', tmpDir);
    const result = await detectFileBasedRoutes(tmpDir, [comp]);

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].category).toBe('ui-route');
    expect(result[0].tags).toContain('file-based-routing');
  });

  it('returns empty without framework config', async () => {
    mkdirSync(join(tmpDir, 'pages'), { recursive: true });
    // No next.config.js or similar

    const comp = makeComponent('plain', tmpDir);
    const result = await detectFileBasedRoutes(tmpDir, [comp]);

    expect(result).toHaveLength(0);
  });
});

describe('detectEntryPoints (combined)', () => {
  it('merges results from all detection strategies', async () => {
    // Set up AST-detectable entry points
    writeSource('src/routes/api.ts', `
app.get('/api/health', healthCheck);
`);
    // Set up manifest entry points
    const comp = makeComponent('my-svc', tmpDir);
    writeSource('package.json', JSON.stringify({
      name: 'my-svc',
      bin: './bin/cli.js',
    }));

    const files = [makeEnhancedFile('src/routes/api.ts')];
    const result = await detectEntryPoints(tmpDir, files, [comp]);

    const categories = new Set(result.map(ep => ep.category));
    expect(categories.has('http-api')).toBe(true);
    expect(categories.has('cli-command')).toBe(true);
  });

  it('manifest results override AST results for same id', async () => {
    const comp = makeComponent('my-cli', tmpDir);
    writeSource('package.json', JSON.stringify({
      name: 'my-cli',
      bin: './bin/cli.js',
    }));
    // Also have AST detection that might find the same CLI
    writeSource('bin/cli.ts', `
const program = new Command();
program.command('my-cli');
`);

    const files: EnhancedFileAnalysis[] = [{
      path: 'bin/cli.ts',
      language: 'typescript',
      symbols: [],
      layer: 'cli',
      componentId: 'my-cli',
    }];

    const result = await detectEntryPoints(tmpDir, files, [comp]);

    // Should not have duplicates with the same normalized id
    const ids = result.map(ep => ep.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});
