import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALIAS_BLOCK_END,
  ALIAS_BLOCK_START,
  aliasBlock,
  detectShell,
  installShellAliases,
  uninstallShellAliases,
} from './shell-aliases.js';

describe('detectShell', () => {
  const originalShell = process.env.SHELL;
  afterEach(() => {
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
  });

  it('detects zsh', () => {
    process.env.SHELL = '/bin/zsh';
    expect(detectShell()).toBe('zsh');
  });
  it('detects bash', () => {
    process.env.SHELL = '/usr/local/bin/bash';
    expect(detectShell()).toBe('bash');
  });
  it('detects fish', () => {
    process.env.SHELL = '/opt/homebrew/bin/fish';
    expect(detectShell()).toBe('fish');
  });
  it('returns null for unknown shells', () => {
    process.env.SHELL = '/bin/csh';
    expect(detectShell()).toBeNull();
  });
  it('returns null when SHELL is unset', () => {
    delete process.env.SHELL;
    expect(detectShell()).toBeNull();
  });
});

describe('aliasBlock', () => {
  it('uses bash/zsh syntax (with =)', () => {
    const block = aliasBlock('zsh');
    expect(block).toContain(`alias commit="pritty commit"`);
    expect(block).toContain(`alias pr="pritty pr"`);
    expect(block).toContain(ALIAS_BLOCK_START);
    expect(block).toContain(ALIAS_BLOCK_END);
  });
  it('uses fish syntax (no =)', () => {
    const block = aliasBlock('fish');
    expect(block).toContain(`alias commit "pritty commit"`);
    expect(block).toContain(`alias pr "pritty pr"`);
    expect(block).not.toContain(`alias commit=`);
  });
});

describe('installShellAliases', () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pritty-aliases-test-'));
    // node:os.homedir() honors $HOME on POSIX. Redirect that for the
    // test scope so we don't write to the developer's real home.
    originalHome = process.env.HOME;
    process.env.HOME = tmp;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('appends a fresh block when rc file is empty', () => {
    const result = installShellAliases('zsh');
    expect(result.replaced).toBe(false);
    expect(result.rcPath).toBe(join(tmp, '.zshrc'));
    const content = readFileSync(result.rcPath, 'utf8');
    expect(content).toContain(ALIAS_BLOCK_START);
    expect(content).toContain(`alias commit="pritty commit"`);
  });

  it('appends to existing rc content without losing data', () => {
    const rcPath = join(tmp, '.zshrc');
    writeFileSync(rcPath, '# my custom config\nexport FOO=bar\n');
    const result = installShellAliases('zsh');
    expect(result.replaced).toBe(false);
    const content = readFileSync(rcPath, 'utf8');
    expect(content).toContain('# my custom config');
    expect(content).toContain('export FOO=bar');
    expect(content).toContain(ALIAS_BLOCK_START);
  });

  it('replaces an existing pritty block instead of duplicating', () => {
    const rcPath = join(tmp, '.zshrc');
    writeFileSync(
      rcPath,
      `# header\n${ALIAS_BLOCK_START}\nalias commit="OLD"\n${ALIAS_BLOCK_END}\n# footer\n`,
    );
    const result = installShellAliases('zsh');
    expect(result.replaced).toBe(true);
    const content = readFileSync(rcPath, 'utf8');
    expect(content).toContain('# header');
    expect(content).toContain('# footer');
    expect(content).toContain(`alias commit="pritty commit"`);
    expect(content).not.toContain(`alias commit="OLD"`);
    // Only ONE start marker
    const matches = content.match(new RegExp(ALIAS_BLOCK_START, 'g'));
    expect(matches?.length).toBe(1);
  });

  it('creates fish config.fish path on fresh install', () => {
    const result = installShellAliases('fish');
    expect(result.rcPath).toBe(join(tmp, '.config', 'fish', 'config.fish'));
    const content = readFileSync(result.rcPath, 'utf8');
    expect(content).toContain(`alias commit "pritty commit"`);
  });

  it('throws on unterminated marker (refuses to mangle)', () => {
    const rcPath = join(tmp, '.zshrc');
    writeFileSync(rcPath, `${ALIAS_BLOCK_START}\nalias commit="OLD"\n# never closed\n`);
    expect(() => installShellAliases('zsh')).toThrow(/Refusing to overwrite/);
  });
});

describe('uninstallShellAliases', () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pritty-aliases-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmp;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('removes the block when present', () => {
    installShellAliases('zsh');
    expect(uninstallShellAliases('zsh')).toBe(true);
    const content = readFileSync(join(tmp, '.zshrc'), 'utf8');
    expect(content).not.toContain(ALIAS_BLOCK_START);
  });

  it('returns false when no block is present', () => {
    writeFileSync(join(tmp, '.zshrc'), '# unrelated\n');
    expect(uninstallShellAliases('zsh')).toBe(false);
  });

  it("returns false when rc file doesn't exist", () => {
    expect(uninstallShellAliases('zsh')).toBe(false);
  });

  it('preserves surrounding content', () => {
    const rcPath = join(tmp, '.zshrc');
    writeFileSync(
      rcPath,
      `# header\n\n${ALIAS_BLOCK_START}\nalias commit="X"\n${ALIAS_BLOCK_END}\n\n# footer\n`,
    );
    uninstallShellAliases('zsh');
    const content = readFileSync(rcPath, 'utf8');
    expect(content).toContain('# header');
    expect(content).toContain('# footer');
    expect(content).not.toContain(ALIAS_BLOCK_START);
  });
});
