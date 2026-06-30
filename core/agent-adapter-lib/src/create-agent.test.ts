import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCapabilities, AgentAdapter, AgentSpec, AgentSpecType } from './agent.ts';
import { createAgent } from './create-agent.ts';
import { WorkdirNotARepoError } from './errors.ts';
import { _clearRegistry, registerAdapter } from './registry.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCaps(overrides: Partial<AdapterCapabilities> = {}): AdapterCapabilities {
  return {
    reportsUsage: true,
    supportsStreaming: true,
    supportsToolUse: true,
    toolUseMode: 'host-loop',
    supportsExtendedThinking: false,
    supportsCancellation: true,
    supportsCapture: true,
    supportsJsonMode: false,
    supportsSessionResume: false,
    ...overrides,
  };
}

function makeAdapter(type: AgentSpecType, workdir: string): AgentAdapter {
  return {
    type,
    workdir,
    capabilities: makeCaps(),
    invoke: vi.fn(),
    stream: vi.fn(),
  };
}

/** Create a temp dir with `git init` applied. Caller must clean up. */
function makeTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-adapter-test-'));
  execFileSync('git', ['-C', dir, 'init', '--quiet'], { encoding: 'utf8' });
  return dir;
}

/** Create a temp dir that is NOT a git repo. */
function makeTmpNonGitDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-adapter-no-git-'));
}

function rmTmpDir(dir: string) {
  try {
    rmdirSync(dir, { recursive: true } as Parameters<typeof rmdirSync>[1]);
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAgent', () => {
  let gitDir: string;
  let nonGitDir: string;

  beforeEach(() => {
    _clearRegistry();
    gitDir = makeTmpGitRepo();
    nonGitDir = makeTmpNonGitDir();
  });

  afterEach(() => {
    _clearRegistry();
    rmTmpDir(gitDir);
    rmTmpDir(nonGitDir);
  });

  describe('workdir validation', () => {
    it('throws WorkdirNotARepoError for a non-git directory', () => {
      // Register a factory so the test reaches the git-check step.
      registerAdapter(
        'claude-sdk',
        (_spec, deps) => makeAdapter('claude-sdk', deps.workdir),
        makeCaps(),
      );

      expect(() =>
        createAgent({
          spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
          workdir: nonGitDir,
        }),
      ).toThrow(WorkdirNotARepoError);
    });

    it('WorkdirNotARepoError message includes the workdir path', () => {
      registerAdapter(
        'claude-sdk',
        (_spec, deps) => makeAdapter('claude-sdk', deps.workdir),
        makeCaps(),
      );

      let thrown: Error | undefined;
      try {
        createAgent({
          spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
          workdir: nonGitDir,
        });
      } catch (err) {
        thrown = err as Error;
      }
      expect(thrown).toBeInstanceOf(WorkdirNotARepoError);
      expect(thrown!.message).toContain(nonGitDir);
    });

    it('succeeds for a valid git working tree (tmp git init)', () => {
      registerAdapter(
        'claude-sdk',
        (_spec, deps) => makeAdapter('claude-sdk', deps.workdir),
        makeCaps(),
      );

      expect(() =>
        createAgent({
          spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
          workdir: gitDir,
        }),
      ).not.toThrow();
    });

    it('succeeds when workdir is the current working directory (a real git tree)', () => {
      // process.cwd() is inside the monorepo's git working tree at test time —
      // portable across machines/CI, unlike a hardcoded absolute path.
      const repoRoot = process.cwd();
      registerAdapter(
        'claude-sdk',
        (_spec, deps) => makeAdapter('claude-sdk', deps.workdir),
        makeCaps(),
      );

      expect(() =>
        createAgent({
          spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
          workdir: repoRoot,
        }),
      ).not.toThrow();
    });
  });

  describe('factory dispatch', () => {
    it('throws for an unregistered spec.type', () => {
      expect(() =>
        createAgent({
          spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
          workdir: gitDir,
        }),
      ).toThrow(/No adapter factory registered/);
    });

    it('error message for unregistered type includes the spec.type', () => {
      let thrown: Error | undefined;
      try {
        createAgent({
          spec: { type: 'opencode-cli', model: 'some-model' },
          workdir: gitDir,
        });
      } catch (err) {
        thrown = err as Error;
      }
      expect(thrown).toBeDefined();
      expect(thrown!.message).toContain('opencode-cli');
    });

    it('calls the registered factory and returns the adapter', () => {
      const fakeAdapter = makeAdapter('claude-sdk', gitDir);
      const factory = vi.fn((_spec: AgentSpec, deps: { workdir: string }) =>
        makeAdapter('claude-sdk', deps.workdir),
      );

      registerAdapter('claude-sdk', factory as never, makeCaps());

      const agent = createAgent({
        spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
        workdir: gitDir,
      });

      expect(factory).toHaveBeenCalledOnce();
      expect(agent.type).toBe('claude-sdk');
      expect(agent.workdir).toBe(gitDir);
      void fakeAdapter; // referenced to avoid unused var
    });

    it('passes workdir, repoRoot, commit, branch to the factory', () => {
      const capturedDeps: Record<string, unknown>[] = [];

      registerAdapter(
        'claude-sdk',
        (_spec, deps) => {
          capturedDeps.push({ ...deps });
          return makeAdapter('claude-sdk', deps.workdir);
        },
        makeCaps(),
      );

      createAgent({
        spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
        workdir: gitDir,
      });

      expect(capturedDeps).toHaveLength(1);
      const deps = capturedDeps[0]!;
      expect(deps.workdir).toBe(gitDir);
      // repoRoot, commit, branch are best-effort strings
      expect(typeof deps.repoRoot).toBe('string');
      expect(typeof deps.commit).toBe('string');
      expect(typeof deps.branch).toBe('string');
    });

    it('threads credentialBroker and logger through to factory deps', () => {
      const capturedDeps: Record<string, unknown>[] = [];
      registerAdapter(
        'claude-sdk',
        (_spec, deps) => {
          capturedDeps.push({ ...deps });
          return makeAdapter('claude-sdk', deps.workdir);
        },
        makeCaps(),
      );

      const broker = { getCredential: vi.fn() };
      const logger = { info: vi.fn() };

      createAgent({
        spec: { type: 'claude-sdk', model: 'claude-opus-4-8' },
        workdir: gitDir,
        credentialBroker: broker,
        logger,
      });

      expect(capturedDeps[0]!.credentialBroker).toBe(broker);
      expect(capturedDeps[0]!.logger).toBe(logger);
    });

    it('works for all AgentSpecTypes when a factory is registered', () => {
      const types: AgentSpecType[] = [
        'claude-sdk',
        'claude-agent-sdk',
        'claude-code-cli',
        'opencode-cli',
        'copilot-sdk',
        'copilot-cli',
      ];

      for (const type of types) {
        _clearRegistry();
        registerAdapter(type, (_s, deps) => makeAdapter(type, deps.workdir), makeCaps());

        const agent = createAgent({
          spec: { type, model: 'some-model' } as AgentSpec,
          workdir: gitDir,
        });
        expect(agent.type).toBe(type);
      }
    });
  });
});
